import type { App } from "./app";
import { Schema, ValidationError } from "./validator";

// ── Type Algebra ─────────────────────────────────────────────────────

// Split "/users/:id" → ["users", ":id"]
type SplitPath<T extends string> =
  T extends `/${infer Rest}` ? SplitPath<Rest> :
  T extends `${infer Seg}/${infer Rest}` ? [Seg, ...SplitPath<Rest>] :
  T extends "" ? [] :
  [T];

// ["users", ":id"] + Value → { users: { ":id": Value } }
type BuildPath<Segments extends string[], Value> =
  Segments extends [infer Head extends string, ...infer Tail extends string[]]
    ? { [K in Head]: BuildPath<Tail, Value> }
    : Value;

// Extract param names: "/users/:id" → "id"
type ParamKeys<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParamKeys<Rest>
    : T extends `${string}:${infer Param}`
      ? Param
      : never;

// Request options (runtime — accepts any json)
type ClientRequestInit = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  json?: unknown;
  headers?: Record<string, string>;
};

// Type-level opts: json is typed when input is declared, query is typed when query schema is declared
type WithJson<I> = [I] extends [never] ? { json?: unknown } : { json: I };
type WithQuery<Q> = [Q] extends [never] ? { query?: Record<string, string> } : {} extends Q ? { query?: { [K in keyof Q]: string } } : { query: { [K in keyof Q]: string } };
type WithParams<Path extends string> = [ParamKeys<Path>] extends [never] ? {} : { params: { [K in ParamKeys<Path>]: string } };
type MethodOpts<Path extends string, I, Q = never> = WithQuery<Q> & WithJson<I> & WithParams<Path> & { headers?: Record<string, string> };
type IsOptionalOpts<Path extends string, I, Q = never> = [ParamKeys<Path>] extends [never] ? ([I] extends [never] ? ([Q] extends [never] ? true : {} extends Q ? true : false) : false) : false;

// Method function type — params required when path has params, json required when input is declared, query required when query schema is declared
type MethodFn<Path extends string, O, I = never, Q = never> =
  IsOptionalOpts<Path, I, Q> extends true
    ? (opts?: MethodOpts<Path, I, Q>) => Promise<ClientResponse<O>>
    : (opts: MethodOpts<Path, I, Q>) => Promise<ClientResponse<O>>;

// Method map: { get: { output: T, input: I, query: Q } } → { $get: MethodFn<...> }
type PathMethods<Path extends string, Methods> = {
  [M in keyof Methods & string as `$${M}`]: Methods[M] extends { output: infer O; input: infer I; query: infer Q }
    ? MethodFn<Path, O, I, Q>
    : Methods[M] extends { output: infer O; input: infer I }
      ? MethodFn<Path, O, I>
      : Methods[M] extends { output: infer O }
        ? MethodFn<Path, O>
        : never;
};

// Convert a union to an intersection
type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

// Deep merge helper
type DeepMerge<A, B> = {
  [K in keyof A | keyof B]:
    K extends keyof A
      ? K extends keyof B
        ? A[K] extends object
          ? B[K] extends object
            ? DeepMerge<A[K], B[K]>
            : B[K]
          : B[K]
        : A[K]
      : K extends keyof B
        ? B[K]
        : never;
};

// Flatten all paths into a deeply merged nested client type
type FlattenSchema<S> =
  UnionToIntersection<
    { [P in keyof S & string]: BuildPath<SplitPath<P>, PathMethods<P, S[P]>> }[keyof S & string]
  >;

// Extract S from App<V, S, BasePath>
type InferSchema<T> = T extends App<any, infer S, any> ? S : never;

// Public: the client type from an App
export type ClientType<T extends App<any, any, any>> = FlattenSchema<InferSchema<T>>;

// ── ClientResponse ───────────────────────────────────────────────────

export class ClientResponse<T> {
  readonly raw: Response;

  constructor(response: Response) {
    this.raw = response;
  }

  get ok(): boolean {
    return this.raw.ok;
  }

  get status(): number {
    return this.raw.status;
  }

  get headers(): Headers {
    return this.raw.headers;
  }

  async json(): Promise<T>;
  async json<S extends Schema<any>>(schema: S): Promise<S["_output"]>;
  async json(schema?: Schema<any>): Promise<unknown> {
    const data = await this.raw.json();
    if (schema) return schema.parse(data);
    return data;
  }

  async text(): Promise<string> {
    return this.raw.text();
  }
}

// ── createClient ─────────────────────────────────────────────────────

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

type CreateClientOptions = {
  fetch?: FetchFn;
  headers?: Record<string, string>;
};

export function createClient<T extends App<any, any, any>>(
  baseUrl: string,
  options?: CreateClientOptions,
): ClientType<T> {
  const fetchFn = options?.fetch ?? globalThis.fetch;
  const defaultHeaders = options?.headers ?? {};

  function buildProxy(segments: string[]): any {
    return new Proxy(() => {}, {
      get(_target, prop: string) {
        if (prop.startsWith("$")) {
          const method = prop.slice(1).toUpperCase();
          return async (opts?: ClientRequestInit) => {
            let path = "/" + segments.join("/");

            // Replace :param segments
            if (opts?.params) {
              for (const [key, value] of Object.entries(opts.params)) {
                path = path.replace(`:${key}`, encodeURIComponent(value));
              }
            }

            let url = baseUrl.replace(/\/$/, "") + path;

            // Append query params
            if (opts?.query) {
              const qs = new URLSearchParams(opts.query).toString();
              if (qs) url += "?" + qs;
            }

            const headers: Record<string, string> = { ...defaultHeaders, ...opts?.headers };
            let body: string | undefined;

            if (opts?.json !== undefined) {
              headers["Content-Type"] = "application/json";
              body = JSON.stringify(opts.json);
            }

            const response = await fetchFn(url, { method, headers, body });
            return new ClientResponse(response);
          };
        }

        return buildProxy([...segments, prop]);
      },
    });
  }

  return buildProxy([]);
}

// ── Re-exports for browser usage ────────────────────────────────────

export { v, Schema, ValidationError } from "./validator";
export type { Infer, ValidationIssue } from "./validator";
