export type CookieOptions = {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type StreamWriter = {
  write(chunk: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  readonly signal: AbortSignal;
};

export type SSEEvent = {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
};

export type SSEWriter = {
  sendEvent(event: SSEEvent): Promise<void>;
  close(): Promise<void>;
  readonly signal: AbortSignal;
};

import type { Schema } from "./validator";
import type { TypedResponse } from "./types";
import { extractPathname } from "./url";

export class Context<
  P extends Record<string, string> = Record<string, string>,
  V extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly req: Request;
  id: string;
  routePath: string | null = null;
  params: P;
  private responseHeaders: Headers;
  private statusCode: number | undefined;
  private _state: Map<string, unknown> = new Map();
  private _var: Readonly<V> | null = null;
  private cookieCache: Record<string, string> | null = null;
  private responseCookies: string[] = [];
  private _url: URL | null = null;
  private _path: string | null = null;
  private _query: URLSearchParams | null = null;

  constructor(req: Request, params: Record<string, string> = {}) {
    this.req = req;
    this.id = crypto.randomUUID();
    this.params = params as P;
    this.responseHeaders = new Headers();
  }

  /** Full parsed URL — lazily constructed on first access. */
  get url(): URL {
    if (this._url === null) {
      this._url = new URL(this.req.url);
    }
    return this._url;
  }

  set<K extends string & keyof V>(key: K, value: V[K]): void {
    this._state.set(key, value);
    this._var = null;
  }

  get<K extends string & keyof V>(key: K): V[K] | undefined {
    return this._state.get(key) as V[K] | undefined;
  }

  get var(): Readonly<V> {
    if (this._var === null) {
      const state = this._state;
      this._var = new Proxy({} as V, {
        get(_, prop) {
          return state.get(prop as string);
        },
        has(_, prop) {
          return state.has(prop as string);
        },
        ownKeys() {
          return [...state.keys()];
        },
        getOwnPropertyDescriptor(_, prop) {
          if (state.has(prop as string)) {
            return { configurable: true, enumerable: true, value: state.get(prop as string) };
          }
          return undefined;
        },
      }) as Readonly<V>;
    }
    return this._var;
  }

  get method(): string {
    return this.req.method;
  }

  get path(): string {
    if (this._path === null) {
      this._path = extractPathname(this.req.url);
    }
    return this._path;
  }

  get query(): URLSearchParams {
    if (this._query === null) {
      const q = extractQueryString(this.req.url);
      this._query = new URLSearchParams(q);
    }
    return this._query;
  }

  get headers(): Headers {
    return this.req.headers;
  }

  async body<S extends Schema<any>>(schema: S): Promise<S["_output"]>;
  async body<T = unknown>(): Promise<T>;
  async body(schema?: any): Promise<unknown> {
    const data = await this.req.json();
    if (schema) return schema.parse(data);
    return data;
  }

  validQuery<S extends Schema<any>>(schema: S): S["_output"] {
    const obj: Record<string, string> = {};
    for (const key of this.query.keys()) {
      obj[key] = this.query.get(key)!;
    }
    return schema.parse(obj);
  }

  validParams<S extends Schema<any>>(schema: S): S["_output"] {
    return schema.parse(this.params);
  }

  async bodyText(): Promise<string> {
    return this.req.text();
  }

  formData(): ReturnType<Request["formData"]> {
    return this.req.formData();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.req.arrayBuffer();
  }

  async blob(): Promise<Blob> {
    return this.req.blob();
  }

  cookie(): Record<string, string>;
  cookie(name: string): string | undefined;
  cookie(name?: string): Record<string, string> | string | undefined {
    if (this.cookieCache === null) {
      this.cookieCache = {};
      const header = this.req.headers.get("Cookie");
      if (header) {
        for (const pair of header.split(";")) {
          const idx = pair.indexOf("=");
          if (idx === -1) continue;
          const key = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          this.cookieCache[key] = decodeURIComponent(value);
        }
      }
    }
    if (name === undefined) return this.cookieCache;
    return this.cookieCache[name];
  }

  setCookie(name: string, value: string, options?: CookieOptions): this {
    let str = `${name}=${encodeURIComponent(value)}`;
    if (options) {
      if (options.domain) str += `; Domain=${options.domain}`;
      if (options.path) str += `; Path=${options.path}`;
      if (options.maxAge !== undefined) str += `; Max-Age=${options.maxAge}`;
      if (options.expires) str += `; Expires=${options.expires.toUTCString()}`;
      if (options.httpOnly) str += "; HttpOnly";
      if (options.secure) str += "; Secure";
      if (options.sameSite) str += `; SameSite=${options.sameSite}`;
    }
    this.responseCookies.push(str);
    return this;
  }

  deleteCookie(name: string, options?: Pick<CookieOptions, "domain" | "path">): this {
    return this.setCookie(name, "", { ...options, maxAge: 0 });
  }

  header(key: string, value: string): this {
    this.responseHeaders.set(key, value);
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json<T>(data: T, status?: number): TypedResponse<T> {
    return new Response(JSON.stringify(data), {
      status: status ?? this.statusCode ?? 200,
      headers: this.buildHeaders({ "Content-Type": "application/json" }),
    }) as TypedResponse<T>;
  }

  text(data: string, status?: number): Response {
    return new Response(data, {
      status: status ?? this.statusCode ?? 200,
      headers: this.buildHeaders({ "Content-Type": "text/plain" }),
    });
  }

  html(data: string, status?: number): Response {
    return new Response(data, {
      status: status ?? this.statusCode ?? 200,
      headers: this.buildHeaders({ "Content-Type": "text/html" }),
    });
  }

  redirect(url: string, status: number = 302): Response {
    return new Response(null, {
      status,
      headers: this.buildHeaders({ Location: url }),
    });
  }

  stream(
    callback: (stream: StreamWriter) => Promise<void> | void,
    status?: number,
  ): Response {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let closed = false;

    const stream: StreamWriter = {
      write(chunk: string | Uint8Array): Promise<void> {
        if (closed) return Promise.resolve();
        return writer.write(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      },
      close(): Promise<void> {
        if (closed) return Promise.resolve();
        closed = true;
        return writer.close();
      },
      abort(reason?: unknown): Promise<void> {
        if (closed) return Promise.resolve();
        closed = true;
        return writer.abort(reason);
      },
      signal: this.req.signal,
    };

    Promise.resolve(callback(stream))
      .then(() => stream.close())
      .catch((err) => stream.abort(err));

    return new Response(readable, {
      status: status ?? this.statusCode ?? 200,
      headers: this.buildHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }

  sse(
    callback: (stream: SSEWriter) => Promise<void> | void,
    status?: number,
  ): Response {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let closed = false;

    const stream: SSEWriter = {
      sendEvent(event: SSEEvent): Promise<void> {
        if (closed) return Promise.resolve();
        let msg = "";
        if (event.id !== undefined) msg += `id: ${event.id}\n`;
        if (event.event) msg += `event: ${event.event}\n`;
        if (event.retry !== undefined) msg += `retry: ${event.retry}\n`;
        for (const line of event.data.split("\n")) {
          msg += `data: ${line}\n`;
        }
        msg += "\n";
        return writer.write(encoder.encode(msg));
      },
      close(): Promise<void> {
        if (closed) return Promise.resolve();
        closed = true;
        return writer.close();
      },
      signal: this.req.signal,
    };

    Promise.resolve(callback(stream))
      .then(() => stream.close())
      .catch((err) => {
        if (!closed) {
          closed = true;
          writer.abort(err);
        }
      });

    return new Response(readable, {
      status: status ?? this.statusCode ?? 200,
      headers: this.buildHeaders({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }),
    });
  }

  private buildHeaders(defaults: Record<string, string>): Headers {
    const headers = new Headers(this.responseHeaders);
    for (const [k, v] of Object.entries(defaults)) {
      if (!headers.has(k)) headers.set(k, v);
    }
    for (const cookie of this.responseCookies) {
      headers.append("Set-Cookie", cookie);
    }
    return headers;
  }
}

function extractQueryString(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return "";
  const hash = url.indexOf("#", q);
  return hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash);
}
