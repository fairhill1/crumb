# Crumb

A minimal, Bun-native web framework. Zero dependencies.

- **Zero dependencies** — pure Bun APIs only
- **Fast** — radix tree routing with O(path length) matching
- **Tiny** — ~2,300 lines of source code
- **Type-safe** — typed route params, end-to-end RPC client with typed requests and responses

## Requirements

- [Bun](https://bun.sh) v1.0 or later

## Installation

```sh
git clone https://github.com/fairhill1/crumb.git
cd crumb
bun install
```

## Quickstart

```ts
import { App } from "crumb";

const app = new App();

app.get("/", (ctx) => ctx.json({ hello: "world" }));

app.listen(3000);
```

```sh
bun run server.ts
```

## Features

### Routing

Register handlers for any HTTP method. Routes support static paths, named parameters (`:id`), and wildcards (`*`). Param types are inferred from the path string literal — you get autocomplete and compile-time typo detection.

```ts
// Static route
app.get("/users", (ctx) => ctx.json(users));

// Named parameter — ctx.params.id is typed as string
app.get("/users/:id", (ctx) => {
  return ctx.json({ id: ctx.params.id });
  // ctx.params.nope  ← compile error!
});

// Multiple params — both inferred
app.get("/users/:id/posts/:postId", (ctx) => {
  return ctx.json({ id: ctx.params.id, postId: ctx.params.postId });
});

// Wildcard — ctx.params["*"] is typed as string
app.get("/files/*", (ctx) => {
  return ctx.text(`Path: ${ctx.params["*"]}`);
});

app.post("/users", async (ctx) => {
  const body = await ctx.body();
  return ctx.json(body, 201);
});

// Body schema — auto-validates and types ctx.validBody + the RPC client's json field
app.put("/users/:id", { body: v.object({ name: v.string() }) }, (ctx) => {
  return ctx.json({ id: ctx.params.id, name: ctx.validBody.name });
});

// Query schema — auto-validates and types ctx.validQuery + the RPC client's query field
app.get("/search", { query: v.object({ q: v.string(), page: v.string().optional() }) }, (ctx) => {
  return ctx.json({ q: ctx.validQuery.q, page: ctx.validQuery.page ?? "1" });
});

// Both body and query schemas
app.post("/items", { body: v.object({ name: v.string() }), query: v.object({ dry: v.string().optional() }) }, (ctx) => {
  return ctx.json({ name: ctx.validBody.name, dry: ctx.validQuery.dry === "true" });
});

// All HTTP methods at once
app.all("/any", (ctx) => ctx.text("any method"));
```

Supported methods: `get`, `post`, `put`, `delete`, `patch`, `all`.

Matching priority: static segments > named parameters > wildcards.

### Middleware

Middleware wraps route handlers. Call `next()` to continue the chain, or return early to short-circuit.

```ts
// Global middleware — runs on every request
app.use(async (ctx, next) => {
  const start = performance.now();
  const res = await next();
  console.log(`${ctx.method} ${ctx.path} ${performance.now() - start}ms`);
  return res;
});

// Scoped middleware — runs only for matching path prefix
app.use("/api", async (ctx, next) => {
  const token = ctx.headers.get("Authorization");
  if (!token) return ctx.json({ error: "Unauthorized" }, 401);
  return next();
});
```

Middleware executes in registration order. Multiple middleware functions compose as an onion: `a → b → handler → b → a`.

#### Route-Level Middleware

Attach middleware directly to a route. Route-level middleware runs after global/scoped middleware and does not affect other routes.

```ts
const auth: Middleware = async (ctx, next) => {
  if (!ctx.headers.get("Authorization")) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }
  return next();
};

// Only this route requires auth
app.get("/admin", auth, (ctx) => ctx.text("secret"));

// Chain up to 3 middleware per route
app.post("/admin/users", auth, validate, (ctx) => ctx.json({ ok: true }));

// Public route — no middleware
app.get("/public", (ctx) => ctx.text("open"));
```

Works with all HTTP methods (`get`, `post`, `put`, `delete`, `patch`, `all`) and route groups.

### CORS

Built-in CORS middleware with full configuration support.

```ts
import { App, cors } from "crumb";

const app = new App();

// Allow all origins (default)
app.use(cors());

// Custom configuration
app.use(cors({
  origin: "https://example.com",
  allowMethods: ["GET", "POST"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["X-Request-Id"],
  credentials: true,
  maxAge: 3600,
}));

// Multiple origins
app.use(cors({
  origin: ["https://example.com", "https://staging.example.com"],
}));

// Dynamic origin validation
app.use(cors({
  origin: (origin) => origin.endsWith(".example.com"),
}));

// Scoped to a path
app.use("/api", cors({ origin: "https://app.example.com" }));
```

Handles preflight `OPTIONS` requests automatically. When `allowHeaders` is not set, it reflects the request's `Access-Control-Request-Headers` header.

### Route Groups

Groups share the parent's router and middleware stack. Nest as deep as you need.

```ts
const api = app.group("/api");
api.get("/health", (ctx) => ctx.text("ok"));
// registers GET /api/health

const v1 = api.group("/v1");
v1.get("/users", (ctx) => ctx.json(users));
// registers GET /api/v1/users
```

### WebSockets

Route-level WebSocket handlers with full middleware support. Handlers are multiplexed through a single server-level WebSocket config.

```ts
// Basic echo
app.ws("/echo", {
  message(ws, msg) {
    ws.send(msg);
  },
});

// Route params + custom state from upgrade hook
app.ws<{ userId: string }>("/chat/:room", {
  upgrade(ctx) {
    const token = ctx.headers.get("Authorization");
    if (!token) return ctx.json({ error: "Unauthorized" }, 401);
    return { userId: parseToken(token) };
  },
  open(ws) {
    ws.subscribe(ws.data.params.room);
  },
  message(ws, msg) {
    ws.publish(ws.data.params.room, `${ws.data.state.userId}: ${msg}`);
  },
  close(ws) {
    ws.unsubscribe(ws.data.params.room);
  },
});

// Works with groups
const api = app.group("/api");
api.ws("/stream", { message(ws, msg) { ws.send(msg); } });
```

The `upgrade` hook runs in HTTP context before the WebSocket upgrade. Return data to populate `ws.data.state`, or return a `Response` to reject the connection. Middleware runs before upgrade, so auth middleware works naturally.

Available hooks: `upgrade`, `open`, `message` (required), `close`, `drain`.

Route params are available on `ws.data.params`. The `app.server` property is set after `listen()` for pub/sub access.

### Streaming Responses

Stream data to the client without buffering the entire response in memory.

```ts
app.get("/download", (ctx) => {
  return ctx.stream(async (stream) => {
    for (let i = 0; i < 5; i++) {
      await stream.write(`chunk ${i}\n`);
      await Bun.sleep(100);
    }
  });
});
```

The callback receives a `StreamWriter` with `write(chunk)`, `close()`, `abort(reason)`, and a `signal` property (the request's `AbortSignal` for detecting client disconnect). The stream auto-closes when the callback returns. Supports both `string` and `Uint8Array` chunks.

### Server-Sent Events (SSE)

Built-in SSE support with proper `text/event-stream` formatting.

```ts
app.get("/events", (ctx) => {
  return ctx.sse(async (stream) => {
    for (let i = 0; i < 10; i++) {
      await stream.sendEvent({
        id: String(i),
        event: "tick",
        data: JSON.stringify({ count: i }),
      });
      await Bun.sleep(1000);
      if (stream.signal.aborted) break;
    }
  });
});
```

`sendEvent` accepts `data` (required), `event`, `id`, and `retry` fields. Multiline `data` is automatically split into multiple `data:` lines per the SSE spec. The response includes `Cache-Control: no-cache` and `Connection: keep-alive` headers.

Both `ctx.stream()` and `ctx.sse()` respect `ctx.header()`, `ctx.status()`, and `ctx.setCookie()`.

### Request Validation

Built-in schema validation with full TypeScript type inference. No external dependencies — works like a lightweight Zod.

```ts
import { App, v } from "crumb";

const app = new App();

const userSchema = v.object({
  name: v.string().min(1),
  age: v.number().optional(),
  tags: v.array(v.string()),
});

app.post("/users", async (ctx) => {
  const data = await ctx.body(userSchema);
  // data is typed as { name: string; age?: number; tags: string[] }
  return ctx.json(data, 201);
});
```

Pass a schema to `ctx.body(schema)` to validate the parsed JSON, or use a **route config** at registration to auto-validate and type both the handler and the RPC client:

```ts
// Route-level body config — auto-parses, validates, and types ctx.validBody
app.post("/users", { body: userSchema }, (ctx) => {
  // ctx.validBody is typed as { name: string; age?: number; tags: string[] }
  return ctx.json({ created: true, name: ctx.validBody.name }, 201);
});

// Route-level query config — auto-validates query params and types ctx.validQuery
app.get("/users", { query: v.object({ role: v.string().optional() }) }, (ctx) => {
  // ctx.validQuery is typed as { role?: string | undefined }
  return ctx.json({ role: ctx.validQuery.role ?? "all" });
});

// Both in one config
app.post("/search", {
  body: v.object({ filters: v.array(v.string()) }),
  query: v.object({ page: v.string() }),
}, (ctx) => {
  return ctx.json({ filters: ctx.validBody.filters, page: ctx.validQuery.page });
});
```

When using the route config, types flow through to the RPC client — `$post({ json: ... })` will require the correct body shape, and `$get({ query: ... })` will require the correct query keys (see [RPC Client](#rpc-client)).

If validation fails, the default error handler returns a 400 response with detailed issues:

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": "name", "message": "Expected string" },
    { "path": "tags[0]", "message": "Expected string" }
  ]
}
```

**Available schemas:**

| Builder | Checks |
|---------|--------|
| `v.string()` | `.min(n)`, `.max(n)`, `.pattern(regex)` |
| `v.number()` | `.min(n)`, `.max(n)`, `.integer()` |
| `v.boolean()` | — |
| `v.array(schema)` | `.min(n)`, `.max(n)` |
| `v.object({ ... })` | validates shape, collects all issues |
| `v.enum(["a", "b"] as const)` | string enum, rejects values not in the list |
| `v.literal(value)` | exact match for a string, number, or boolean |
| `v.union([schema, ...] as const)` | accepts the first matching schema |
| `v.record(schema)` | string-keyed object, validates every value |
| `v.date()` | `.min(date)`, `.max(date)` — parses date strings into `Date` |

All schemas support `.optional()`, `.nullable()`, and `.message(msg)` for custom error messages.

**Coercion schemas:**

Use `v.coerce.*` to convert string inputs (query params, route params) into the target type before validation:

| Builder | Coerces from | Notes |
|---------|-------------|-------|
| `v.coerce.string()` | number, boolean | All checks (`.min`, `.max`, `.pattern`) apply after coercion |
| `v.coerce.number()` | string | Trims whitespace, rejects empty strings and NaN |
| `v.coerce.boolean()` | string | `"true"`/`"1"` → `true`, `"false"`/`"0"`/`""` → `false` |

**Transforms:**

Chain `.transform(fn)` to convert a validated value into a different type:

```ts
// Trim whitespace after validation
const name = v.string().min(1).transform((s) => s.trim());

// Coerce string to number
const port = v.string().transform(Number);

// Transform objects
const user = v.object({ name: v.string() }).transform((u) => ({
  ...u,
  name: u.name.toUpperCase(),
}));
```

**Custom error messages:**

```ts
v.string().message("Name is required");
v.number().min(0).message("Must be positive");
v.enum(["admin", "user"] as const).message("Invalid role");
```

**Type inference:**

Use the `Infer<S>` type helper to extract the output type from any schema:

```ts
import type { Infer } from "crumb";

const schema = v.object({ name: v.string() });
type User = Infer<typeof schema>; // { name: string }

// Works with all schema types
type Status = Infer<typeof v.enum(["active", "inactive"] as const)>;
// "active" | "inactive"
```

### Query/Param Validation

**Route-level query config** (recommended) — auto-validates and types `ctx.validQuery`, and flows query types through to the RPC client:

```ts
app.get("/items", { query: v.object({ page: v.string(), limit: v.string() }) }, (ctx) => {
  return ctx.json({ page: ctx.validQuery.page, limit: ctx.validQuery.limit });
});
// Client: api.items.$get({ query: { page: "1", limit: "20" } })
// query keys are typed and required
```

**Inline validation** — validate and coerce query string parameters and route parameters using `v.coerce.*` schemas. Since query params and route params are always strings, coercion schemas automatically convert them to the target type.

```ts
// Query params — coerce strings to numbers
app.get("/items", (ctx) => {
  const { page, limit } = ctx.validQuery(
    v.object({
      page: v.coerce.number().min(1),
      limit: v.coerce.number().max(100),
    }),
  );
  // page and limit are typed as number
  return ctx.json({ page, limit });
});

// Route params — coerce :id to number
app.get("/users/:id", (ctx) => {
  const { id } = ctx.validParams(
    v.object({ id: v.coerce.number().integer() }),
  );
  // id is typed as number
  return ctx.json({ id });
});

// Boolean query params
app.get("/search", (ctx) => {
  const { q, active } = ctx.validQuery(
    v.object({
      q: v.string().min(1),
      active: v.coerce.boolean().optional(),
    }),
  );
  return ctx.json({ q, active });
});
```

Validation errors are caught by the error handler and return 400 with detailed issues, just like `ctx.body(schema)`.

### Context Helpers

Every handler receives a single `Context` object.

**Request properties:**

| Property | Type | Description |
|----------|------|-------------|
| `ctx.method` | `string` | HTTP method (GET, POST, etc.) |
| `ctx.path` | `string` | URL pathname (`/users/42`) |
| `ctx.params` | `{ id: string; ... }` | Route parameters, inferred from path |
| `ctx.query` | `URLSearchParams` | Query string parameters |
| `ctx.headers` | `Headers` | Request headers |
| `ctx.req` | `Request` | Raw Bun `Request` object |
| `ctx.cookie(name)` | `string \| undefined` | Read a request cookie by name |
| `ctx.cookie()` | `Record<string, string>` | Read all request cookies |
| `ctx.body<T>()` | `Promise<T>` | Parse JSON request body |
| `ctx.body(schema)` | `Promise<Infer<S>>` | Parse and validate JSON body (see [Validation](#request-validation)) |
| `ctx.validBody` | `I` | Pre-parsed body when route uses `{ body: schema }` config (see [Validation](#request-validation)) |
| `ctx.validQuery` | `Q` | Pre-parsed query when route uses `{ query: schema }` config (see [Query/Param Validation](#queryparam-validation)) |
| `ctx.validQuery(schema)` | `Infer<S>` | Validate and coerce query params inline |
| `ctx.validParams(schema)` | `Infer<S>` | Validate and coerce route params |
| `ctx.bodyText()` | `Promise<string>` | Raw text request body |
| `ctx.formData()` | `Promise<FormData>` | Parse multipart/urlencoded form data |
| `ctx.arrayBuffer()` | `Promise<ArrayBuffer>` | Raw request body as ArrayBuffer |
| `ctx.blob()` | `Promise<Blob>` | Raw request body as Blob |
| `ctx.id` | `string` | Unique request ID (UUID, mutable) |
| `ctx.routePath` | `string \| null` | Matched route pattern (e.g. `/users/:id`), null if unmatched |
| `ctx.set(key, value)` | `void` | Store typed request-scoped state (see [Typed Variables](#typed-variables)) |
| `ctx.get(key)` | `V[K] \| undefined` | Retrieve typed request-scoped state |
| `ctx.var` | `Readonly<V>` | Property-style access to request-scoped state |

**Response helpers:**

| Method | Description |
|--------|-------------|
| `ctx.json(data, status?)` | JSON response with `application/json` |
| `ctx.text(data, status?)` | Plain text response with `text/plain` |
| `ctx.html(data, status?)` | HTML response with `text/html` |
| `ctx.redirect(url, status?)` | Redirect (302 by default) |
| `ctx.stream(callback, status?)` | Streaming response (see [Streaming](#streaming-responses)) |
| `ctx.sse(callback, status?)` | SSE response (see [Server-Sent Events](#server-sent-events-sse)) |
| `ctx.setCookie(name, value, options?)` | Set a response cookie (chainable) |
| `ctx.deleteCookie(name, options?)` | Delete a cookie via Max-Age=0 (chainable) |
| `ctx.header(key, value)` | Set a response header (chainable) |
| `ctx.status(code)` | Set default response status (chainable) |

Headers and status set via `ctx.header()` / `ctx.status()` are applied to the next response helper call:

```ts
app.get("/", (ctx) => {
  return ctx
    .header("X-Request-Id", "abc")
    .status(201)
    .json({ created: true });
});
```

### Static Files

```ts
// Serve files from ./public at /static/*
app.static("/static", "./public");

// Works with route groups
const assets = app.group("/assets");
assets.static("/files", "./uploads");
```

Serves files with correct MIME types, falls back to `index.html` for directories, and blocks path traversal attacks. Responses include `ETag`, `Last-Modified`, and `Cache-Control` headers. Conditional requests (`If-None-Match`, `If-Modified-Since`) return `304 Not Modified`.

If no file is found, the static handler calls your `notFound` handler — so you can use it as a fallback for SPA routing or custom 404 pages:

```ts
app.static("/", "./public");
app.notFound((ctx) => ctx.html(Bun.file("./public/index.html")));
```

> **Note:** Avoid registering `app.get("/*", ...)` alongside `app.static()` on the same prefix — the wildcard route will overwrite the static file handler. Use `notFound` for catch-all fallback behavior instead.

HEAD requests are automatically handled for all GET routes — the response headers are preserved but the body is stripped.

### Compression

Built-in gzip/deflate compression middleware using Bun's native `Bun.gzipSync` / `Bun.deflateSync`.

```ts
import { App, compress } from "crumb";

const app = new App();

// Compress responses larger than 1KB (default)
app.use(compress());

// Custom threshold and encoding preference
app.use(compress({
  threshold: 512,
  encodings: ["gzip", "deflate"],
}));
```

Respects the client's `Accept-Encoding` header with quality values. Skips streaming responses, already-encoded responses, and responses smaller than the threshold. Adds `Vary: Accept-Encoding` automatically.

### Typed Variables

Declare a type parameter on `App` to get type-safe request-scoped state across middleware and handlers.

```ts
type Vars = { user: { id: number; role: string }; requestId: string };

const app = new App<Vars>();

app.use(async (ctx, next) => {
  ctx.set("user", { id: 1, role: "admin" });  // type-checked
  ctx.set("requestId", crypto.randomUUID());
  return next();
});

app.get("/me", (ctx) => {
  const user = ctx.get("user");       // typed as { id: number; role: string } | undefined
  const rid = ctx.var.requestId;       // property-style access
  return ctx.json({ user, rid });
});
```

`ctx.var` is a read-only proxy over the state map — it always reflects the latest values. Groups inherit the parent's type parameter.

### RPC Client

End-to-end type-safe client for Crumb apps. Get path autocomplete, typed responses, and optional runtime validation — no code generation.

```ts
// server.ts
import { App, v } from "crumb";

const app = new App()
  .get("/users/:id", (ctx) => {
    return ctx.json({ id: ctx.params.id, name: "Alice" });
  })
  .post("/users", { body: v.object({ name: v.string() }) }, (ctx) => {
    return ctx.json({ success: true, name: ctx.validBody.name });
  });

export type AppRouter = typeof app;
app.listen(3000);
```

```ts
// client.ts
import { createClient, v } from "crumb/client";
import type { AppRouter } from "./server";

const api = createClient<AppRouter>("http://localhost:3000");

// Path autocomplete, typed response
const res = await api.users[":id"].$get({ params: { id: "42" } });
const data = await res.json(); // { id: string; name: string }

// POST with typed JSON body — json field is required and type-checked
const created = await api.users.$post({ json: { name: "Bob" } });
const result = await created.json(); // { success: boolean; name: string }

// Type errors at compile time:
// api.users.$post({ json: { name: 123 } });  ← type error: number not assignable to string
// api.users.$post();                          ← type error: json is required

// Runtime validation (optional) — reuses the same `v` schemas
const userSchema = v.object({ id: v.string(), name: v.string() });
const validated = await res.json(userSchema); // validated at runtime
```

**How it works:**

1. `ctx.json(data)` returns `TypedResponse<T>` — a phantom-branded `Response` that carries the data type
2. Each `.get()`, `.post()`, etc. call accumulates the route schema (output type + input type when `{ body: schema }` is provided) on the `App` type parameter
3. `createClient<AppRouter>(baseUrl)` reads the schema and builds a typed proxy — property access builds URL segments, `$get()`/`$post()` etc. trigger `fetch()` with typed `json` fields

**Client options:**

```ts
const api = createClient<AppRouter>("http://localhost:3000", {
  fetch: customFetch,                    // custom fetch implementation
  headers: { Authorization: "Bearer …" }, // default headers for all requests
});
```

**Request options:**

```ts
await api.users[":id"].$get({
  params: { id: "42" },         // URL params (required when path has :params)
  query: { include: "posts" },  // query string — typed when route uses { query: schema }, otherwise Record<string, string>
  headers: { "X-Custom": "1" }, // per-request headers
  json: { name: "Bob" },       // JSON body — typed when route uses { body: schema }, otherwise unknown
});
```

**`ClientResponse<T>`:**

| Property/Method | Description |
|----------------|-------------|
| `.ok` | `boolean` — response status is 2xx |
| `.status` | `number` — HTTP status code |
| `.headers` | `Headers` — response headers |
| `.json()` | `Promise<T>` — typed JSON parsing |
| `.json(schema)` | `Promise<S["_output"]>` — runtime validated JSON parsing |
| `.text()` | `Promise<string>` — raw text |
| `.raw` | `Response` — underlying fetch Response |

**Schema accumulation:**

Each `.get()`, `.post()`, etc. call returns a new `App` type with the route added to the schema. TypeScript can only widen the type through the return value — it cannot mutate a variable's type in place. This means routes must be **chained** for types to accumulate.

The preferred pattern for organizing routes into modules is `.route(prefix, child)` — create standalone `App` instances and mount them:

```ts
// users.ts
export const userRoutes = new App()
  .get("/users", (ctx) => ctx.json([]))
  .post("/users", { body: v.object({ name: v.string() }) }, (ctx) => {
    return ctx.json({ created: true, name: ctx.validBody.name });
  });

// posts.ts
export const postRoutes = new App()
  .get("/posts", (ctx) => ctx.json([]))
  .get("/posts/:id", (ctx) => ctx.json({ id: ctx.params.id }));

// server.ts
const app = new App()
  .route("/api", userRoutes)
  .route("/api", postRoutes);
export type AppRouter = typeof app; // all routes at /api/users, /api/posts, etc.
```

For cases where you want to compose routes without a prefix, use `.route(child)`:

```ts
const app = new App()
  .route(userRoutes)
  .route(postRoutes);
```

Alternatively, use `.pipe()` to thread routes through a function — useful when routes need access to the parent's type variables:

```ts
import type { App, SchemaMap } from "crumb";

function userRoutes<V extends Record<string, unknown>, S extends SchemaMap, B extends string>(app: App<V, S, B>) {
  return app
    .get("/users", (ctx) => ctx.json([]))
    .post("/users", { body: v.object({ name: v.string() }) }, (ctx) => {
      return ctx.json({ created: true, name: ctx.validBody.name });
    });
}

const app = new App().pipe(userRoutes);
export type AppRouter = typeof app;
```

The `.pipe()` generic signature `<V, S, B>` is required to preserve the incoming schema. `SchemaMap` is the exported constraint type for `S`.

```ts
// Imperative — types are LOST (return values discarded):
const app = new App();
app.get("/users", handler);      // ← schema lost
export type AppRouter = typeof app; // only has {}
```

**Known limitations:**
- `group()` resets the schema accumulator — export the group's type directly if needed, or use `.route()` instead
- Routes without a `{ body: schema }` config have `json` typed as `unknown` on the client, and `query` defaults to `Record<string, string>`

### Named Routes

Name routes with `.as()` and generate URLs with `app.url()`. Avoids hardcoded paths across the codebase.

```ts
app.get("/users/:id", handler).as("user.show");
app.get("/files/*", handler).as("files");

app.url("user.show", { id: "42" });  // "/users/42"
app.url("files", { "*": "a/b/c" }); // "/files/a/b/c"

// Works with groups
const api = app.group("/api");
api.get("/posts/:id", handler).as("api.post");
app.url("api.post", { id: "5" });   // "/api/posts/5"
```

Throws if the name is unknown, a required param is missing, or a duplicate name is registered.

### Route Introspection

List all registered routes programmatically:

```ts
app.get("/users", handler);
app.post("/users", handler);
app.get("/users/:id", handler);

console.log(app.routes);
// [
//   { method: "GET", path: "/users" },
//   { method: "POST", path: "/users" },
//   { method: "GET", path: "/users/:id" },
// ]
```

### OpenAPI / Swagger

Generate an OpenAPI 3.1 spec from your routes. Body/query schemas, path parameters, and response schemas are derived automatically. Add documentation metadata (summary, tags, etc.) directly on the route config.

```ts
import { App, v } from "crumb";

const app = new App();

app.get("/users", {
  summary: "List users",
  tags: ["users"],
}, (ctx) => ctx.json([]));

app.post("/users", {
  body: v.object({ name: v.string().min(1), role: v.enum(["admin", "user"] as const) }),
  summary: "Create user",
  tags: ["users"],
  response: v.object({ id: v.number(), name: v.string() }),
}, (ctx) => ctx.json({ id: 1, name: ctx.validBody.name }));

app.get("/users/:id", {
  summary: "Get user",
  tags: ["users"],
}, (ctx) => ctx.json({ id: ctx.params.id }));
```

**Serve the spec as JSON** — mounts a `GET /openapi.json` route (point any UI tool at it):

```ts
app.swagger({ title: "My API", version: "1.0.0" });
// custom path:
app.swagger({ title: "My API", version: "1.0.0" }, { path: "/api/spec.json" });
```

**Get the spec as a plain object** — useful for writing to a file or serving yourself:

```ts
const spec = app.openapi({ title: "My API", version: "1.0.0", description: "..." });
// standard OpenAPI 3.1.0 document — paths, requestBody, parameters, responses, etc.
```

**Available `RouteMeta` fields** (all optional, on any route config):

| Field | Type | Description |
|-------|------|-------------|
| `summary` | `string` | Short operation summary |
| `description` | `string` | Longer description |
| `tags` | `string[]` | Group operations in the UI |
| `operationId` | `string` | Unique operation identifier |
| `deprecated` | `boolean` | Mark the operation as deprecated |
| `response` | `Schema` or `{ [status]: Schema }` | Response schema(s) |

**Schema → JSON Schema mapping:**

| Crumb schema | JSON Schema output |
|---|---|
| `v.string().min(1).max(100)` | `{ type: "string", minLength: 1, maxLength: 100 }` |
| `v.number().integer().min(0)` | `{ type: "integer", minimum: 0 }` |
| `v.boolean()` | `{ type: "boolean" }` |
| `v.array(v.string()).min(1)` | `{ type: "array", items: { type: "string" }, minItems: 1 }` |
| `v.object({ ... })` | `{ type: "object", properties: {...}, required: [...] }` |
| `v.enum(["a","b"] as const)` | `{ type: "string", enum: ["a","b"] }` |
| `v.literal("x")` | `{ const: "x" }` |
| `v.union([...] as const)` | `{ oneOf: [...] }` |
| `v.record(v.number())` | `{ type: "object", additionalProperties: { type: "number" } }` |
| `v.date()` | `{ type: "string", format: "date-time" }` |
| `schema.nullable()` | `{ oneOf: [inner, { type: "null" }] }` |
| `schema.optional()` | inner schema (field omitted from `required`) |

### Error Handling

```ts
// Custom 404
app.notFound((ctx) => ctx.json({ error: "Not found" }, 404));

// Global error handler — catches thrown errors
app.onError((err, ctx) => {
  console.error(err);
  return ctx.json({ error: "Internal server error" }, 500);
});
```

Errors thrown in middleware or handlers are caught and passed to `onError`. The default handler returns 400 with issues for `ValidationError`, and logs + returns 500 for all other errors.

### Graceful Shutdown

`listen()` automatically registers `SIGTERM` and `SIGINT` handlers that drain in-flight requests before exiting. You can also shut down programmatically:

```ts
// Graceful — waits for in-flight requests to finish
await app.close();

// Force — terminates all connections immediately
await app.close(true);
```

Calling `close()` is idempotent and safe to call even if the server hasn't started. Signal handlers are cleaned up automatically.

### Testing

Use `app.request()` to test routes without starting a server:

```ts
import { expect, test } from "bun:test";

test("GET /", async () => {
  const app = new App();
  app.get("/", (ctx) => ctx.json({ ok: true }));

  const res = await app.request("/");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// Full RequestInit support
const res = await app.request("/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "alice" }),
});
```

`app.request()` accepts a path string, full URL, or `Request` object.

## API Reference

### `App`

| Method | Description |
|--------|-------------|
| `new App<Vars?>()` | Create a new application (optional typed variables); type accumulates route schema for RPC client |
| `.get(path, config?, ...middleware?, handler)` | Register a GET route |
| `.post(path, config?, ...middleware?, handler)` | Register a POST route |
| `.put(path, config?, ...middleware?, handler)` | Register a PUT route |
| `.delete(path, config?, ...middleware?, handler)` | Register a DELETE route |
| `.patch(path, config?, ...middleware?, handler)` | Register a PATCH route |
| `.all(path, ...middleware?, handler)` | Register a route for all HTTP methods |
| `.pipe(fn)` | Thread app through a function, preserving schema accumulation |
| `.route(child)` | Mount a child `App` at its own paths, merging schema |
| `.route(prefix, child)` | Mount a child `App` at `prefix`, merging schema |
| `.use(middleware)` | Add global middleware |
| `.use(path, middleware)` | Add scoped middleware |
| `.group(prefix)` | Create a route group |
| `.ws(path, handler)` | Register a WebSocket route |
| `.static(urlPrefix, root)` | Serve static files from a directory |
| `.as(name)` | Name the last registered route (for URL generation) |
| `.url(name, params?)` | Generate a URL from a named route |
| `.routes` | `{ method, path }[]` — list all registered routes |
| `.openapi(info)` | Return OpenAPI 3.1 spec as a plain object |
| `.swagger(info, opts?)` | Mount `GET /openapi.json` serving the spec; `opts.path` overrides the path |
| `.notFound(handler)` | Set custom 404 handler |
| `.onError(handler)` | Set global error handler |
| `.request(input, init?)` | Send a test request (no server needed) |
| `.server` | `Server \| null` — set after `listen()`, for pub/sub |
| `.listen(port)` | Start the HTTP server, returns `Server` |
| `.close(closeActive?)` | Graceful shutdown — drain connections then stop |

### TypeScript Types

```ts
import type { ExtractParams, Handler, Middleware, Route, HTTPMethod, SchemaMap, CorsOptions, CompressOptions, CookieOptions, WSHandler, WSData, StreamWriter, SSEWriter, SSEEvent, Infer, ValidationIssue, TypedResponse, InferData, RouteMeta, OpenAPIInfo, SwaggerOptions } from "crumb";
import { App, v, ValidationError, Schema, cors, compress } from "crumb";
import { createClient, ClientResponse } from "crumb/client";

// Extracts typed params from a path literal
type ExtractParams<"/users/:id"> = { id: string };
type ExtractParams<"/files/*"> = { "*": string };

type Handler<V = Record<string, unknown>> = (ctx: Context<Record<string, string>, V>) => Response | Promise<Response>;

type Middleware<V = Record<string, unknown>> = (ctx: Context<Record<string, string>, V>, next: () => Promise<Response>) => Response | Promise<Response>;

type CompressOptions = {
  threshold?: number;           // default: 1024
  encodings?: ("gzip" | "deflate")[];
};

type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

type CorsOptions = {
  origin?: string | string[] | ((origin: string) => boolean);
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
};

type CookieOptions = {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type WSHandler<T = unknown> = {
  upgrade?: (ctx: Context) => T | Response | Promise<T | Response>;
  open?: (ws: ServerWebSocket<WSData<T>>) => void | Promise<void>;
  message: (ws: ServerWebSocket<WSData<T>>, message: string | Buffer) => void | Promise<void>;
  close?: (ws: ServerWebSocket<WSData<T>>, code: number, reason: string) => void | Promise<void>;
  drain?: (ws: ServerWebSocket<WSData<T>>) => void | Promise<void>;
};

type WSData<T = unknown> = {
  params: Record<string, string>;
  state: T;
};

type StreamWriter = {
  write(chunk: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  readonly signal: AbortSignal;
};

type SSEEvent = {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
};

type SSEWriter = {
  sendEvent(event: SSEEvent): Promise<void>;
  close(): Promise<void>;
  readonly signal: AbortSignal;
};

type ValidationIssue = { path: string; message: string };

class ValidationError extends Error {
  readonly issues: ValidationIssue[];
}

// Extract output type from a schema
type Infer<S extends Schema<any>> = S["_output"];

// Phantom-branded Response that carries data type (returned by ctx.json())
type TypedResponse<T = unknown> = Response & { readonly __type: T };

// Extract T from TypedResponse<T>, falls back to unknown for plain Response
type InferData<R> = R extends TypedResponse<infer T> ? T : unknown;

// Constraint for the S type parameter of App — use in route module function signatures
type SchemaMap = Record<string, Record<string, { output: unknown }>>;

type RouteMeta = {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  operationId?: string;
  response?: Schema<any> | Record<number, Schema<any>>;
};

type OpenAPIInfo = {
  title: string;
  version: string;
  description?: string;
  [key: string]: unknown;
};

type SwaggerOptions = {
  path?: string; // default: "/openapi.json"
};
```

## Running Tests

```sh
bun test
```

The test suite covers routing, middleware (global, scoped, and route-level), context helpers, cookies, CORS, streaming, SSE, static files, WebSockets, typed params, request validation, RPC client (including typed inputs), pipe composition, route mounting, graceful shutdown, and error handling (347 tests).

## Examples

Run the included example:

```sh
bun run example
# or
bun run examples/basic.ts
```

See [`examples/basic.ts`](examples/basic.ts) for a complete working app with logging middleware, parameterized routes, route groups, and static file serving.

## Design

- **Zero dependencies** — pure Bun APIs only
- **Return-based** — handlers return `Response`, no mutation
- **Single context arg** — `(ctx) =>` not `(req, res, next) =>`
- **Radix tree routing** — segment-based trie, O(path length) matching
- **Lazy parsing** — URL, query string, and body only parsed when accessed
- **Chainable** — `use()`, `header()`, `status()` all return `this`

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your branch (`git checkout -b my-change`)
3. Make your changes
4. Run the tests (`bun test`)
5. Commit and push
6. Open a pull request

## License

[MIT](LICENSE)
