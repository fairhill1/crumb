import { describe, test, expect } from "bun:test";
import { App } from "../src/app";
import { createClient, ClientResponse, v, ValidationError } from "../src/client";
import type { ClientType } from "../src/client";
import type { TypedResponse, InferData } from "../src/types";

// ── Test app setup ──────────────────────────────────────────────────

const app = new App()
  .get("/health", (ctx) => {
    return ctx.json({ status: "ok" });
  })
  .get("/users/:id", (ctx) => {
    return ctx.json({ id: ctx.params.id, name: "Alice" });
  })
  .post("/users", async (ctx) => {
    const body = await ctx.body<{ name: string }>();
    return ctx.json({ success: true, name: body.name }, 201);
  })
  .put("/users/:id", async (ctx) => {
    const body = await ctx.body<{ name: string }>();
    return ctx.json({ id: ctx.params.id, name: body.name });
  })
  .delete("/users/:id", (ctx) => {
    return ctx.json({ deleted: true, id: ctx.params.id });
  })
  .patch("/users/:id", async (ctx) => {
    const body = await ctx.body<{ name?: string }>();
    return ctx.json({ id: ctx.params.id, ...body });
  })
  .get("/posts/:postId/comments/:commentId", (ctx) => {
    return ctx.json({
      postId: ctx.params.postId,
      commentId: ctx.params.commentId,
    });
  });

type TestApp = typeof app;

// Custom fetch that routes through app.request()
const localFetch = (input: string | Request | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return app.request(url, init as RequestInit);
};

const api = createClient<TestApp>("http://localhost:3000", { fetch: localFetch });

// ── Runtime tests ───────────────────────────────────────────────────

describe("createClient", () => {
  describe("URL building", () => {
    test("simple path", async () => {
      const res = await api.health.$get();
      expect(res).toBeInstanceOf(ClientResponse);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    });

    test("path with single param", async () => {
      const res = await api.users[":id"].$get({ params: { id: "42" } });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "42", name: "Alice" });
    });

    test("path with multiple params", async () => {
      const res = await api.posts[":postId"].comments[":commentId"].$get({
        params: { postId: "10", commentId: "5" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ postId: "10", commentId: "5" });
    });

    test("query params are appended", async () => {
      // Query params don't affect routing for this test, but verify URL building
      const res = await api.health.$get({ query: { format: "json" } });
      expect(res.ok).toBe(true);
    });
  });

  describe("HTTP methods", () => {
    test("POST with JSON body", async () => {
      const res = await api.users.$post({ json: { name: "Bob" } });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual({ success: true, name: "Bob" });
    });

    test("PUT with params and body", async () => {
      const res = await api.users[":id"].$put({
        params: { id: "42" },
        json: { name: "Updated" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "42", name: "Updated" });
    });

    test("DELETE with params", async () => {
      const res = await api.users[":id"].$delete({ params: { id: "42" } });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ deleted: true, id: "42" });
    });

    test("PATCH with params and body", async () => {
      const res = await api.users[":id"].$patch({
        params: { id: "42" },
        json: { name: "Patched" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "42", name: "Patched" });
    });
  });

  describe("ClientResponse", () => {
    test("raw property exposes underlying Response", async () => {
      const res = await api.health.$get();
      expect(res.raw).toBeInstanceOf(Response);
      expect(res.raw.ok).toBe(true);
    });

    test("headers are accessible", async () => {
      const res = await api.health.$get();
      expect(res.headers.get("content-type")).toBe("application/json");
    });

    test("text() returns raw text", async () => {
      const res = await api.health.$get();
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ status: "ok" });
    });

    test("json() with schema validates response", async () => {
      const schema = v.object({ id: v.string(), name: v.string() });
      const res = await api.users[":id"].$get({ params: { id: "42" } });
      const data = await res.json(schema);
      expect(data).toEqual({ id: "42", name: "Alice" });
    });

    test("json() with schema throws ValidationError on mismatch", async () => {
      const badSchema = v.object({ id: v.number(), name: v.string() });
      const res = await api.users[":id"].$get({ params: { id: "42" } });
      expect(res.json(badSchema)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("custom headers", () => {
    test("default headers are sent", async () => {
      const headerApp = new App()
        .get("/echo-header", (ctx) => {
          return ctx.json({ auth: ctx.headers.get("authorization") });
        });

      const headerFetch = (input: string | Request | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        return headerApp.request(url, init as RequestInit);
      };

      const headerApi = createClient<typeof headerApp>("http://localhost:3000", {
        fetch: headerFetch,
        headers: { Authorization: "Bearer token123" },
      });

      const res = await headerApi["echo-header"].$get();
      const data = await res.json();
      expect(data).toEqual({ auth: "Bearer token123" });
    });
  });
});

// ── Type-level tests (compile-time) ─────────────────────────────────

describe("type tests", () => {
  test("ctx.json() returns TypedResponse", () => {
    // Verify the type is correct at compile time
    type CheckApp = typeof app;
    type _assert = CheckApp extends App<any, infer S, any>
      ? "/health" extends keyof S
        ? true
        : false
      : false;

    // This is a runtime test that the type system is working
    const _check: _assert = true;
    expect(_check).toBe(true);
  });

  test("TypedResponse phantom type works", () => {
    type TR = TypedResponse<{ x: number }>;
    type Extracted = InferData<TR>;
    // If InferData works, Extracted should be { x: number }
    const _check: Extracted = { x: 1 };
    expect(_check.x).toBe(1);
  });

  test("InferData falls back to unknown for plain Response", () => {
    type Extracted = InferData<Response>;
    // Extracted should be unknown
    const _check: Extracted = "anything";
    expect(_check).toBe("anything");
  });

  test("schema accumulates across chained routes", () => {
    // Verify the schema has accumulated both routes
    type Schema = TestApp extends App<any, infer S, any> ? S : never;
    type HasHealth = "/health" extends keyof Schema ? true : false;
    type HasUsers = "/users/:id" extends keyof Schema ? true : false;
    type HasPostUsers = "/users" extends keyof Schema ? true : false;

    const _h: HasHealth = true;
    const _u: HasUsers = true;
    const _pu: HasPostUsers = true;
    expect(_h && _u && _pu).toBe(true);
  });

  test("client params are required for parameterized routes", () => {
    // @ts-expect-error - params is required for /users/:id
    api.users[":id"].$get();

    // @ts-expect-error - params.id is required
    api.users[":id"].$get({ params: {} });

    // This should work (no error)
    api.users[":id"].$get({ params: { id: "1" } });
  });

  test("client opts are optional for non-parameterized routes", () => {
    // This should work without any args
    api.health.$get();

    // This should also work with opts
    api.health.$get({ query: { test: "1" } });
  });
});

// ── Typed input (body schema) tests ──────────────────────────────────

const typedApp = new App()
  .post("/items", { body: v.object({ name: v.string(), price: v.number() }) }, (ctx) => {
    return ctx.json({ created: true, item: ctx.validBody });
  })
  .put("/items/:id", { body: v.object({ name: v.string() }) }, (ctx) => {
    return ctx.json({ id: ctx.params.id, name: ctx.validBody.name });
  })
  .patch("/items/:id", { body: v.object({ name: v.string().optional() }) }, (ctx) => {
    return ctx.json({ id: ctx.params.id, ...ctx.validBody });
  })
  .get("/plain", (ctx) => {
    return ctx.json({ ok: true });
  });

type TypedApp = typeof typedApp;

const typedFetch = (input: string | Request | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return typedApp.request(url, init as RequestInit);
};

const typedApi = createClient<TypedApp>("http://localhost:3000", { fetch: typedFetch });

describe("typed input (body schema)", () => {
  describe("runtime", () => {
    test("POST with body schema parses and validates", async () => {
      const res = await typedApi.items.$post({ json: { name: "Widget", price: 9.99 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ created: true, item: { name: "Widget", price: 9.99 } });
    });

    test("POST with invalid body returns 400", async () => {
      const res = await typedApi.items.$post({ json: { name: 123, price: "bad" } as any });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toBe("Validation failed");
    });

    test("PUT with body schema and params", async () => {
      const res = await typedApi.items[":id"].$put({
        params: { id: "42" },
        json: { name: "Updated" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "42", name: "Updated" });
    });

    test("PATCH with body schema and params", async () => {
      const res = await typedApi.items[":id"].$patch({
        params: { id: "7" },
        json: { name: "Patched" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "7", name: "Patched" });
    });

    test("routes without body config still work", async () => {
      const res = await typedApi.plain.$get();
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ ok: true });
    });
  });

  describe("type-level", () => {
    test("json is required when body schema is declared", () => {
      // @ts-expect-error - json is required for typed POST
      typedApi.items.$post();

      // @ts-expect-error - json is required (can't pass empty opts)
      typedApi.items.$post({});

      // This should work
      typedApi.items.$post({ json: { name: "x", price: 1 } });
    });

    test("json must match the schema shape", () => {
      // @ts-expect-error - missing price field
      typedApi.items.$post({ json: { name: "x" } });

      // @ts-expect-error - wrong type for price
      typedApi.items.$post({ json: { name: "x", price: "bad" } });
    });

    test("params and json both required for parameterized typed routes", () => {
      // @ts-expect-error - missing params
      typedApi.items[":id"].$put({ json: { name: "x" } });

      // @ts-expect-error - missing json
      typedApi.items[":id"].$put({ params: { id: "1" } });

      // This should work
      typedApi.items[":id"].$put({ params: { id: "1" }, json: { name: "x" } });
    });

    test("opts remain optional for routes without body schema", () => {
      // This should work without any args
      typedApi.plain.$get();
      typedApi.plain.$get({ query: { a: "1" } });
    });

    test("input type is accumulated in schema", () => {
      type S = TypedApp extends App<any, infer Schema, any> ? Schema : never;
      type PostInput = S["/items"]["post"]["input"];
      // PostInput should be { name: string; price: number }
      const _check: PostInput = { name: "x", price: 1 };
      expect(_check).toEqual({ name: "x", price: 1 });
    });
  });
});

// ── Typed query schema tests ─────────────────────────────────────────

const queryApp = new App()
  .get("/search", { query: v.object({ q: v.string(), page: v.string().optional() }) }, (ctx) => {
    return ctx.json({ q: ctx.validQuery.q, page: ctx.validQuery.page ?? "1" });
  })
  .get("/items/:id/reviews", { query: v.object({ sort: v.string() }) }, (ctx) => {
    return ctx.json({ id: ctx.params.id, sort: ctx.validQuery.sort });
  })
  .post("/filter", { body: v.object({ tags: v.array(v.string()) }), query: v.object({ limit: v.string() }) }, (ctx) => {
    return ctx.json({ tags: ctx.validBody.tags, limit: ctx.validQuery.limit });
  })
  .get("/plain-q", (ctx) => {
    return ctx.json({ ok: true });
  });

type QueryApp = typeof queryApp;

const queryFetch = (input: string | Request | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return queryApp.request(url, init as RequestInit);
};

const queryApi = createClient<QueryApp>("http://localhost:3000", { fetch: queryFetch });

describe("typed query schema", () => {
  describe("runtime", () => {
    test("GET with query schema parses and validates", async () => {
      const res = await queryApi.search.$get({ query: { q: "hello", page: "2" } });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ q: "hello", page: "2" });
    });

    test("GET with query schema and optional field", async () => {
      const res = await queryApi.search.$get({ query: { q: "test" } });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ q: "test", page: "1" });
    });

    test("GET with query schema and params", async () => {
      const res = await queryApi.items[":id"].reviews.$get({
        params: { id: "42" },
        query: { sort: "newest" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ id: "42", sort: "newest" });
    });

    test("GET with invalid query returns 400", async () => {
      const res = await queryApi.search.$get({ query: {} as any });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toBe("Validation failed");
    });

    test("POST with body + query schema", async () => {
      const res = await queryApi.filter.$post({
        json: { tags: ["a", "b"] },
        query: { limit: "10" },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ tags: ["a", "b"], limit: "10" });
    });

    test("routes without query config still work", async () => {
      const res = await queryApi["plain-q"].$get();
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toEqual({ ok: true });
    });
  });

  describe("type-level", () => {
    test("query is required when query schema is declared", () => {
      // @ts-expect-error - query is required
      queryApi.search.$get();

      // @ts-expect-error - query is required (can't pass empty opts)
      queryApi.search.$get({});

      // This should work
      queryApi.search.$get({ query: { q: "x" } });
    });

    test("query keys must match schema shape", () => {
      // @ts-expect-error - missing q field
      queryApi.search.$get({ query: {} });

      // This should work (page is optional)
      queryApi.search.$get({ query: { q: "x" } });
    });

    test("params and query both required for parameterized query routes", () => {
      // @ts-expect-error - missing params
      queryApi.items[":id"].reviews.$get({ query: { sort: "x" } });

      // @ts-expect-error - missing query
      queryApi.items[":id"].reviews.$get({ params: { id: "1" } });

      // This should work
      queryApi.items[":id"].reviews.$get({ params: { id: "1" }, query: { sort: "x" } });
    });

    test("body + query both required when both schemas declared", () => {
      // @ts-expect-error - missing json
      queryApi.filter.$post({ query: { limit: "10" } });

      // @ts-expect-error - missing query
      queryApi.filter.$post({ json: { tags: ["a"] } });

      // This should work
      queryApi.filter.$post({ json: { tags: ["a"] }, query: { limit: "10" } });
    });

    test("opts remain optional for routes without query schema", () => {
      queryApi["plain-q"].$get();
      queryApi["plain-q"].$get({ query: { anything: "goes" } });
    });

    test("opts are optional when all query params are optional", () => {
      const allOptApp = new App()
        .get("/search", { query: v.object({ page: v.string().optional(), sort: v.string().optional() }) }, (ctx) => {
          return ctx.json({ page: ctx.validQuery.page, sort: ctx.validQuery.sort });
        });

      type AllOptApp = typeof allOptApp;
      const allOptFetch = (input: string | Request | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        return allOptApp.request(url, init as RequestInit);
      };
      const allOptApi = createClient<AllOptApp>("http://localhost:3000", { fetch: allOptFetch });

      // opts should be optional — all query params are optional
      allOptApi.search.$get();
      allOptApi.search.$get({ query: { page: "2" } });
      allOptApi.search.$get({ query: {} });
    });

    test("query type is accumulated in schema", () => {
      type S = QueryApp extends App<any, infer Schema, any> ? Schema : never;
      type SearchQuery = S["/search"]["get"]["query"];
      // SearchQuery should be { q: string; page?: string | undefined }
      const _check: SearchQuery = { q: "x" };
      expect(_check).toEqual({ q: "x" });
    });
  });
});

// ── pipe() tests ─────────────────────────────────────────────────────

function addUsers<V extends Record<string, unknown>, S extends Record<string, Record<string, { output: unknown }>>, B extends string>(app: App<V, S, B>) {
  return app
    .get("/users", (ctx) => ctx.json([{ id: "1", name: "Alice" }]))
    .post("/users", { body: v.object({ name: v.string() }) }, (ctx) => {
      return ctx.json({ created: true, name: ctx.validBody.name }, 201);
    });
}

function addHealth<V extends Record<string, unknown>, S extends Record<string, Record<string, { output: unknown }>>, B extends string>(app: App<V, S, B>) {
  return app.get("/health", (ctx) => ctx.json({ up: true }));
}

const pipedApp = new App()
  .pipe(addUsers)
  .pipe(addHealth);

type PipedApp = typeof pipedApp;

const pipedFetch = (input: string | Request | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return pipedApp.request(url, init as RequestInit);
};

const pipedApi = createClient<PipedApp>("http://localhost:3000", { fetch: pipedFetch });

describe("pipe()", () => {
  test("routes from piped functions work at runtime", async () => {
    const res = await pipedApi.health.$get();
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ up: true });
  });

  test("typed body flows through pipe", async () => {
    const res = await pipedApi.users.$post({ json: { name: "Bob" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true, name: "Bob" });
  });

  test("schema accumulates across piped functions", () => {
    type S = PipedApp extends App<any, infer Schema, any> ? Schema : never;
    type HasUsers = "/users" extends keyof S ? true : false;
    type HasHealth = "/health" extends keyof S ? true : false;
    const _u: HasUsers = true;
    const _h: HasHealth = true;
    expect(_u && _h).toBe(true);
  });

  test("typed json is required for piped routes with body schema", () => {
    // @ts-expect-error - json is required
    pipedApi.users.$post();

    // This should work
    pipedApi.users.$post({ json: { name: "x" } });
  });

  test("opts remain optional for piped routes without body schema", () => {
    pipedApi.health.$get();
    pipedApi.users.$get();
  });
});

// ── route() tests ─────────────────────────────────────────────────────

const userRoutes = new App()
  .get("/users", (ctx) => ctx.json([{ id: "1", name: "Alice" }]))
  .post("/users", { body: v.object({ name: v.string() }) }, (ctx) => {
    return ctx.json({ created: true, name: ctx.validBody.name }, 201);
  })
  .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));

const postRoutes = new App()
  .get("/posts", (ctx) => ctx.json([]))
  .get("/posts/:id", (ctx) => ctx.json({ id: ctx.params.id }));

const routedApp = new App()
  .route("/api", userRoutes)
  .route("/api", postRoutes)
  .get("/health", (ctx) => ctx.json({ up: true }));

type RoutedApp = typeof routedApp;

const routedFetch = (input: string | Request | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return routedApp.request(url, init as RequestInit);
};

const routedApi = createClient<RoutedApp>("http://localhost:3000", { fetch: routedFetch });

describe("route()", () => {
  test("routes from child app work at prefixed path", async () => {
    const res = await routedApi.api.users.$get();
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("route params work through mounted child", async () => {
    const res = await routedApi.api.users[":id"].$get({ params: { id: "42" } });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: "42" });
  });

  test("typed body flows through mounted child", async () => {
    const res = await routedApi.api.users.$post({ json: { name: "Bob" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true, name: "Bob" });
  });

  test("multiple mounted children all work", async () => {
    const res = await routedApi.api.posts.$get();
    expect(res.ok).toBe(true);

    const healthRes = await routedApi.health.$get();
    expect(healthRes.ok).toBe(true);
  });

  test("schema accumulates from mounted children", () => {
    type S = RoutedApp extends App<any, infer Schema, any> ? Schema : never;
    type HasUsers = "/api/users" extends keyof S ? true : false;
    type HasPosts = "/api/posts" extends keyof S ? true : false;
    type HasHealth = "/health" extends keyof S ? true : false;
    const _u: HasUsers = true;
    const _p: HasPosts = true;
    const _h: HasHealth = true;
    expect(_u && _p && _h).toBe(true);
  });

  test("typed json is required for mounted routes with body schema", () => {
    // @ts-expect-error - json is required
    routedApi.api.users.$post();

    // This should work
    routedApi.api.users.$post({ json: { name: "x" } });
  });

  test("route() without prefix mounts at child paths", async () => {
    const child = new App().get("/ping", (ctx) => ctx.json({ pong: true }));
    const parent = new App().route(child);
    const res = await parent.request("/ping");
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ pong: true });
  });
});
