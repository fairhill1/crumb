/// <reference types="bun-types" />
import { resolve } from "node:path";
import { Context } from "./context";
import { Router } from "./router";
import type { ExtractParams, Handler, Middleware, WSHandler, WSData, InferData, SchemaMap } from "./types";
import { ValidationError, Schema } from "./validator";
import { buildOpenAPISpec, type OpenAPIInfo, type RouteOpenAPIMeta } from "./openapi";

export type RouteMeta = {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  operationId?: string;
  response?: Schema<any> | Record<number, Schema<any>>;
};

export type SwaggerOptions = {
  path?: string; // default: "/openapi.json"
};

type ScopedMiddleware<V extends Record<string, unknown> = Record<string, unknown>> = { path: string | null; fn: Middleware<V> };

type RouteHandler<P extends string, V extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<ExtractParams<P>, V>) => Response | Promise<Response>;

type MergePath<Base extends string, Path extends string> =
  Base extends "" ? Path : `${Base}${Path}`;

type ToSchema<M extends string, P extends string, O, I = never, Q = never> = {
  [path in P]: { [method in Lowercase<M>]: { output: O; input: I; query: Q } }
};

type PrefixSchema<Prefix extends string, S extends SchemaMap> = {
  [K in keyof S as MergePath<Prefix, K & string>]: S[K]
};

export class App<
  V extends Record<string, unknown> = Record<string, unknown>,
  S extends SchemaMap = {},
  BasePath extends string = "",
> {
  private router = new Router();
  private middlewares: ScopedMiddleware<V>[] = [];
  private routeOpenAPI: RouteOpenAPIMeta[] = [];
  private prefix: string;
  private lastPath: string | null = null;
  private wsFlag: { value: boolean } = { value: false };
  private _signalHandler: (() => void) | null = null;
  server: ReturnType<typeof Bun.serve> | null = null;
  private notFoundHandler: Handler<V> = (ctx) =>
    ctx.json({ error: "Not Found" }, 404);
  private errorHandler: (err: unknown, ctx: Context<Record<string, string>, V>) => Response = (
    err,
    ctx,
  ) => {
    if (err instanceof ValidationError) {
      return ctx.json({ error: "Validation failed", issues: err.issues }, 400);
    }
    console.error(err);
    return ctx.json({ error: "Internal Server Error" }, 500);
  };

  constructor(prefix: string = "") {
    this.prefix = prefix;
  }

  use(pathOrMiddleware: string | Middleware<V>, middleware?: Middleware<V>): App<V, S, BasePath> {
    if (typeof pathOrMiddleware === "string") {
      this.middlewares.push({ path: this.prefix + pathOrMiddleware, fn: middleware! });
    } else {
      this.middlewares.push({ path: this.prefix || null, fn: pathOrMiddleware });
    }
    return this as any;
  }

  get<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  get<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  get<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  get<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  get<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  get<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  get<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  get<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  get<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  get<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  get<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  get<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  get<P extends string, R extends Response>(path: P, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  get<P extends string, R extends Response>(path: P, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  get<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  get<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"GET", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  get<P extends string>(path: P, ...args: any[]): any {
    return this.registerRoute("GET", path, args);
  }

  post<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  post<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  post<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  post<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  post<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  post<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  post<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  post<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  post<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  post<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  post<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  post<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  post<P extends string, R extends Response>(path: P, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  post<P extends string, R extends Response>(path: P, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  post<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  post<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"POST", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  post<P extends string>(path: P, ...args: any[]): any {
    return this.registerRoute("POST", path, args);
  }

  put<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  put<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  put<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  put<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  put<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  put<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  put<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  put<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  put<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  put<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  put<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  put<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  put<P extends string, R extends Response>(path: P, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  put<P extends string, R extends Response>(path: P, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  put<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  put<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PUT", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  put<P extends string>(path: P, ...args: any[]): any {
    return this.registerRoute("PUT", path, args);
  }

  delete<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  delete<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  delete<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  delete<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  delete<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  delete<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  delete<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  delete<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  delete<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  delete<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  delete<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  delete<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  delete<P extends string, R extends Response>(path: P, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  delete<P extends string, R extends Response>(path: P, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  delete<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  delete<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"DELETE", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  delete<P extends string>(path: P, ...args: any[]): any {
    return this.registerRoute("DELETE", path, args);
  }

  patch<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  patch<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  patch<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  patch<P extends string, I, Q, R extends Response>(path: P, config: { body: Schema<I>; query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I } & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I, Q>, BasePath>;
  patch<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  patch<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  patch<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  patch<P extends string, I, R extends Response>(path: P, config: { body: Schema<I> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validBody: I }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, I>, BasePath>;
  patch<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  patch<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  patch<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  patch<P extends string, Q, R extends Response>(path: P, config: { query: Schema<Q> } & RouteMeta, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V> & { readonly validQuery: Q }) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>, never, Q>, BasePath>;
  patch<P extends string, R extends Response>(path: P, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  patch<P extends string, R extends Response>(path: P, m1: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  patch<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  patch<P extends string, R extends Response>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: (ctx: Context<ExtractParams<P>, V>) => R | Promise<R>): App<V, S & ToSchema<"PATCH", MergePath<BasePath, P>, InferData<R>>, BasePath>;
  patch<P extends string>(path: P, ...args: any[]): any {
    return this.registerRoute("PATCH", path, args);
  }

  all<P extends string>(path: P, handler: RouteHandler<P, V>): App<V, S, BasePath>;
  all<P extends string>(path: P, m1: Middleware<V>, handler: RouteHandler<P, V>): App<V, S, BasePath>;
  all<P extends string>(path: P, m1: Middleware<V>, m2: Middleware<V>, handler: RouteHandler<P, V>): App<V, S, BasePath>;
  all<P extends string>(path: P, m1: Middleware<V>, m2: Middleware<V>, m3: Middleware<V>, handler: RouteHandler<P, V>): App<V, S, BasePath>;
  all<P extends string>(path: P, ...args: any[]): any {
    const handler = args.pop() as Handler<V>;
    const middleware = args as Middleware<V>[];
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
      this.addRoute(method, path, handler, middleware);
    }
    return this;
  }

  ws<T = unknown, P extends string = string>(path: P, handler: WSHandler<T>): App<V, S, BasePath> {
    this.wsFlag.value = true;
    this.router.add("WS", this.prefix + path, handler as unknown as Handler);
    return this as any;
  }

  pipe<T>(fn: (app: this) => T): T {
    return fn(this);
  }

  route<ChildV extends Record<string, unknown>, ChildS extends SchemaMap, ChildBase extends string>(child: App<ChildV, ChildS, ChildBase>): App<V, S & PrefixSchema<"", ChildS>, BasePath>;
  route<Prefix extends string, ChildV extends Record<string, unknown>, ChildS extends SchemaMap, ChildBase extends string>(prefix: Prefix, child: App<ChildV, ChildS, ChildBase>): App<V, S & PrefixSchema<Prefix, ChildS>, BasePath>;
  route(prefixOrChild: string | App<any, any, any>, maybeChild?: App<any, any, any>): any {
    const [prefix, child] = typeof prefixOrChild === "string"
      ? [prefixOrChild, maybeChild!]
      : ["", prefixOrChild];
    if (child.wsFlag.value) this.wsFlag.value = true;
    for (const { method, path, handler } of child.router.entries()) {
      const fullPath = prefix + path;
      this.router.add(method, fullPath, handler);
      this.lastPath = fullPath;
    }
    for (const meta of child.routeOpenAPI) {
      this.routeOpenAPI.push({ ...meta, path: prefix + meta.path });
    }
    return this;
  }

  group<Prefix extends string>(prefix: Prefix): App<V, {}, MergePath<BasePath, Prefix>> {
    const sub = new App(this.prefix + prefix);
    // Share the same router, middleware stack, wsFlag, and openapi metadata
    sub.router = this.router;
    sub.middlewares = this.middlewares as any;
    sub.routeOpenAPI = this.routeOpenAPI;
    sub.wsFlag = this.wsFlag;
    sub.notFoundHandler = this.notFoundHandler as any;
    sub.errorHandler = this.errorHandler as any;
    return sub as any;
  }

  openapi(info: OpenAPIInfo): Record<string, unknown> {
    return buildOpenAPISpec(this.routeOpenAPI, info);
  }

  swagger(info: OpenAPIInfo, opts: SwaggerOptions = {}): App<V, S, BasePath> {
    const specPath = opts.path ?? "/openapi.json";
    this.addRoute("GET", specPath, () =>
      new Response(JSON.stringify(this.openapi(info), null, 2), {
        headers: { "content-type": "application/json" },
      }),
    );
    return this as any;
  }

  as(name: string): App<V, S, BasePath> {
    this.router.setName(name, this.lastPath!);
    return this as any;
  }

  url(name: string, params?: Record<string, string>): string {
    return this.router.url(name, params);
  }

  get routes(): { method: string; path: string }[] {
    return this.router.routes();
  }

  notFound(handler: Handler<V>): App<V, S, BasePath> {
    this.notFoundHandler = handler;
    return this as any;
  }

  onError(handler: (err: unknown, ctx: Context<Record<string, string>, V>) => Response): App<V, S, BasePath> {
    this.errorHandler = handler;
    return this as any;
  }

  request(input: string | Request, init?: RequestInit): Promise<Response> {
    if (typeof input === "string") {
      const url = input.startsWith("http://") || input.startsWith("https://") ? input : `http://localhost${input}`;
      input = new Request(url, init);
    }
    return this.handleRequest(input) as Promise<Response>;
  }

  static(urlPrefix: string, root: string): App<V, S, BasePath> {
    const prefix = urlPrefix.endsWith("/") ? urlPrefix.slice(0, -1) : urlPrefix;
    const absRoot = resolve(root);

    // Cache resolved path → BunFile for known-existing files.
    // Avoids repeated Bun.file() + exists() stat syscalls on every request.
    const cache = new Map<string, ReturnType<typeof Bun.file>>();
    const MAX_CACHE = 1024;

    const lookup = async (path: string): Promise<ReturnType<typeof Bun.file> | null> => {
      let file = cache.get(path);
      if (file) {
        // Move to end so it's treated as most-recently-used
        cache.delete(path);
        cache.set(path, file);
        return file;
      }
      file = Bun.file(path);
      if (await file.exists()) {
        if (cache.size >= MAX_CACHE) {
          // Evict the least-recently-used entry (first in insertion order)
          cache.delete(cache.keys().next().value!);
        }
        cache.set(path, file);
        return file;
      }
      return null;
    };

    const handler: Handler<V> = async (ctx) => {
      const filePath = decodeURIComponent(ctx.params["*"] ?? "");

      const resolved = filePath
        ? resolve(absRoot, filePath)
        : absRoot;

      if (!resolved.startsWith(absRoot)) {
        return ctx.text("Forbidden", 403);
      }

      const file = (await lookup(resolved)) ?? (await lookup(resolved + "/index.html"));
      if (!file) return this.notFoundHandler(ctx);

      const mtime = file.lastModified;
      const lastModified = new Date(mtime).toUTCString();
      const etag = `"${file.size.toString(36)}-${mtime.toString(36)}"`;

      const ifNoneMatch = ctx.req.headers.get("if-none-match");
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { etag, "last-modified": lastModified } });
      }

      const ifModifiedSince = ctx.req.headers.get("if-modified-since");
      if (ifModifiedSince && Math.floor(mtime / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000)) {
        return new Response(null, { status: 304, headers: { etag, "last-modified": lastModified } });
      }

      return new Response(file, {
        headers: {
          etag,
          "last-modified": lastModified,
          "cache-control": "public, max-age=0, must-revalidate",
        },
      });
    };

    this.addRoute("GET", prefix + "/*", handler);
    this.addRoute("HEAD", prefix + "/*", handler);
    this.addRoute("GET", prefix, handler);
    this.addRoute("HEAD", prefix, handler);
    return this as any;
  }

  close(closeActive?: boolean): Promise<void> {
    if (this._signalHandler) {
      process.removeListener("SIGTERM", this._signalHandler);
      process.removeListener("SIGINT", this._signalHandler);
      this._signalHandler = null;
    }
    if (!this.server) return Promise.resolve();
    const p = this.server.stop(closeActive);
    this.server = null;
    return p;
  }

  listen(port: number) {
    const fetch = (req: Request, server: any) =>
      this.handleRequest(req, server) as Promise<Response>;

    const wsData = (ws: { data: unknown }) => ws.data as WSData;

    const server = this.wsFlag.value
      ? Bun.serve<WSData>({
          port,
          fetch,
          websocket: {
            open(ws) {
              try {
                wsData(ws)._handler.open?.(ws);
              } catch (err) {
                console.error(err);
                ws.close(1011, "Internal Error");
              }
            },
            message(ws, msg) {
              try {
                wsData(ws)._handler.message(ws, msg);
              } catch (err) {
                console.error(err);
                ws.close(1011, "Internal Error");
              }
            },
            close(ws, code, reason) {
              try {
                wsData(ws)._handler.close?.(ws, code, reason);
              } catch (err) {
                console.error(err);
              }
            },
            drain(ws) {
              try {
                wsData(ws)._handler.drain?.(ws);
              } catch (err) {
                console.error(err);
              }
            },
          },
        })
      : Bun.serve({ port, fetch });

    this.server = server;

    this._signalHandler = () => {
      this.close().then(() => process.exit(0));
    };
    process.on("SIGTERM", this._signalHandler);
    process.on("SIGINT", this._signalHandler);

    console.log(`Listening on http://localhost:${server.port}`);
    return server;
  }

  private registerRoute(method: string, path: string, args: any[]): any {
    const handler = args.pop() as Handler<V>;
    let bodySchema: Schema<any> | null = null;
    let querySchema: Schema<any> | null = null;
    let routeMeta: RouteMeta = {};
    const CONFIG_KEYS = ["body", "query", "summary", "description", "tags", "deprecated", "operationId", "response"];
    if (args.length > 0 && typeof args[0] === "object" && args[0] !== null && CONFIG_KEYS.some((k) => k in args[0])) {
      const config = args.shift() as { body?: Schema<any>; query?: Schema<any> } & RouteMeta;
      bodySchema = config.body ?? null;
      querySchema = config.query ?? null;
      routeMeta = {
        summary: config.summary,
        description: config.description,
        tags: config.tags,
        deprecated: config.deprecated,
        operationId: config.operationId,
        response: config.response,
      };
    }
    this.routeOpenAPI.push({
      method,
      path: this.prefix + path,
      bodySchema,
      querySchema,
      ...routeMeta,
    });
    const middleware = args as Middleware<V>[];
    if (bodySchema || querySchema) {
      const bSchema = bodySchema;
      const qSchema = querySchema;
      const wrapped: Handler<V> = async (ctx) => {
        if (qSchema) {
          const obj: Record<string, string> = {};
          for (const key of ctx.query.keys()) {
            obj[key] = ctx.query.get(key)!;
          }
          (ctx as any).validQuery = qSchema.parse(obj);
        }
        if (bSchema) {
          let raw: unknown;
          try { raw = await ctx.req.json(); } catch {
            throw new ValidationError([{ path: "", message: "Expected JSON body" }]);
          }
          (ctx as any).validBody = bSchema.parse(raw);
        }
        return handler(ctx);
      };
      return this.addRoute(method, path, wrapped, middleware);
    }
    return this.addRoute(method, path, handler, middleware);
  }

  private addRoute(method: string, path: string, handler: Handler<V>, middleware: Middleware<V>[] = []): any {
    const composed = middleware.length === 0
      ? handler
      : (ctx: Context<Record<string, string>, V>) => {
          let i = 0;
          const next = (): Promise<Response> => {
            if (i >= middleware.length) return Promise.resolve(handler(ctx));
            return Promise.resolve(middleware[i++]!(ctx, next));
          };
          return next();
        };
    const fullPath = this.prefix + path;
    this.router.add(method, fullPath, composed as Handler);
    this.lastPath = fullPath;
    return this;
  }

  private async handleRequest(req: Request, server?: any): Promise<Response | undefined> {
    const ctx = new Context<Record<string, string>, V>(req);

    try {
      // WebSocket upgrade path
      if (server && req.headers.get("upgrade") === "websocket") {
        const matched = this.router.match("WS", req.url);
        if (matched) {
          ctx.params = matched.params;
          ctx.routePath = matched.routePath;
          const wsHandler = matched.handler as unknown as WSHandler;

          const response = await this.runMiddlewares(ctx, async () => {
            let state: unknown = undefined;
            if (wsHandler.upgrade) {
              const result = await wsHandler.upgrade(ctx);
              if (result instanceof Response) return result;
              state = result;
            }

            const upgraded = server.upgrade(req, {
              data: {
                _handler: wsHandler,
                params: ctx.params,
                state,
              },
            });

            if (upgraded) {
              return new Response(null, { status: 101 });
            }
            return ctx.json({ error: "WebSocket upgrade failed" }, 500);
          });

          if (response.status === 101) return undefined;
          return response;
        }
      }

      const isHead = req.method === "HEAD";
      const matched = this.router.match(req.method, req.url)
        ?? (isHead ? this.router.match("GET", req.url) : null);

      if (!matched) {
        return await this.runMiddlewares(ctx, () =>
          Promise.resolve(this.notFoundHandler(ctx)),
        );
      }

      ctx.params = matched.params;
      ctx.routePath = matched.routePath;
      const handler = matched.handler;

      const response = await this.runMiddlewares(ctx, () =>
        Promise.resolve(handler(ctx)),
      );

      if (isHead) {
        return new Response(null, {
          status: response.status,
          headers: response.headers,
        });
      }

      return response;
    } catch (err) {
      return this.errorHandler(err, ctx);
    }
  }

  private async runMiddlewares(
    ctx: Context<Record<string, string>, V>,
    final: () => Promise<Response>,
  ): Promise<Response> {
    const applicable = this.middlewares.filter(
      (m) => m.path === null || ctx.path.startsWith(m.path),
    );

    let index = 0;
    const next = (): Promise<Response> => {
      if (index >= applicable.length) return final();
      const mw = applicable[index++]!;
      return Promise.resolve(mw.fn(ctx, next));
    };

    return next();
  }
}
