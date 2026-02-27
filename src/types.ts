import type { ServerWebSocket } from "bun";
import type { Context } from "./context";

// Extracts union of param name literals from a route path
type ParamKeys<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParamKeys<Rest>
    : T extends `${string}:${infer Param}`
      ? Param
      : T extends `${string}*`
        ? "*"
        : never;

// Maps a path string literal to a typed params object
export type ExtractParams<T extends string> =
  string extends T
    ? Record<string, string>
    : { [K in ParamKeys<T>]: string };

export type Handler<V extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<Record<string, string>, V>) => Response | Promise<Response>;

export type Middleware<V extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: Context<Record<string, string>, V>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export type Route = {
  method: string;
  path: string;
  handler: Handler;
};

export type TypedResponse<T = unknown> = Response & { readonly __type: T };
export type InferData<R> = R extends TypedResponse<infer T> ? T : unknown;

export type SchemaMap = Record<string, Record<string, { output: unknown }>>;

export type HTTPMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

export type WSData<T = unknown> = {
  _handler: WSHandler<T>;
  params: Record<string, string>;
  state: T;
};

export type WSHandler<T = unknown> = {
  upgrade?: (ctx: Context) => T | Response | Promise<T | Response>;
  open?: (ws: ServerWebSocket<WSData<T>>) => void | Promise<void>;
  message: (ws: ServerWebSocket<WSData<T>>, message: string | Buffer) => void | Promise<void>;
  close?: (ws: ServerWebSocket<WSData<T>>, code: number, reason: string) => void | Promise<void>;
  drain?: (ws: ServerWebSocket<WSData<T>>) => void | Promise<void>;
};
