import type { Middleware } from "./types";

export type CorsOptions = {
  origin?: string | string[] | ((origin: string) => boolean);
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
};

const defaults: Required<CorsOptions> = {
  origin: "*",
  allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
  allowHeaders: [],
  exposeHeaders: [],
  maxAge: 0,
  credentials: false,
};

function resolveOrigin(
  option: CorsOptions["origin"],
  requestOrigin: string | null,
): string | null {
  if (!requestOrigin) return null;

  if (option === "*") return "*";
  if (typeof option === "string") return option === requestOrigin ? option : null;
  if (typeof option === "function") return option(requestOrigin) ? requestOrigin : null;
  if (Array.isArray(option)) return option.includes(requestOrigin) ? requestOrigin : null;

  return null;
}

export function cors(options: CorsOptions = {}): Middleware {
  const opts = { ...defaults, ...options };

  return async (ctx, next) => {
    const requestOrigin = ctx.headers.get("Origin");
    const origin = resolveOrigin(opts.origin, requestOrigin);

    // If no matching origin, skip CORS headers
    if (!origin) {
      return next();
    }

    const isPreflight = ctx.method === "OPTIONS";

    if (isPreflight) {
      const res = new Response(null, { status: 204 });
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Methods", opts.allowMethods.join(", "));

      const allowHeaders =
        opts.allowHeaders.length > 0
          ? opts.allowHeaders.join(", ")
          : ctx.headers.get("Access-Control-Request-Headers") ?? "";
      if (allowHeaders) {
        res.headers.set("Access-Control-Allow-Headers", allowHeaders);
      }

      if (opts.maxAge > 0) {
        res.headers.set("Access-Control-Max-Age", String(opts.maxAge));
      }

      if (opts.credentials) {
        res.headers.set("Access-Control-Allow-Credentials", "true");
      }

      if (origin !== "*") {
        res.headers.set("Vary", "Origin");
      }

      return res;
    }

    // Actual request
    const res = await next();
    res.headers.set("Access-Control-Allow-Origin", origin);

    if (opts.exposeHeaders.length > 0) {
      res.headers.set("Access-Control-Expose-Headers", opts.exposeHeaders.join(", "));
    }

    if (opts.credentials) {
      res.headers.set("Access-Control-Allow-Credentials", "true");
    }

    if (origin !== "*") {
      res.headers.set("Vary", "Origin");
    }

    return res;
  };
}
