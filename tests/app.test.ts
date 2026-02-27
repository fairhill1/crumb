import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { App } from "../src/app";
import type { Middleware } from "../src/types";
import { v, ValidationError } from "../src/validator";

function req(app: App<any>, path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init);
}

const fixturesDir = resolve(import.meta.dir, "fixtures/public");

describe("App", () => {
  describe("routing", () => {
    test("GET /", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.json({ hello: "world" }));
      const res = await req(app, "/");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hello: "world" });
    });

    test("GET with params", async () => {
      const app = new App();
      app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));
      const res = await req(app, "/users/42");
      expect(await res.json()).toEqual({ id: "42" });
    });

    test("POST with JSON body", async () => {
      const app = new App();
      app.post("/users", async (ctx) => {
        const body = await ctx.body();
        return ctx.json(body, 201);
      });
      const res = await req(app, "/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alice" }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ name: "alice" });
    });

    test("PUT", async () => {
      const app = new App();
      app.put("/items/:id", (ctx) => ctx.json({ updated: ctx.params.id }));
      const res = await req(app, "/items/7", { method: "PUT" });
      expect(await res.json()).toEqual({ updated: "7" });
    });

    test("DELETE", async () => {
      const app = new App();
      app.delete("/items/:id", (ctx) => ctx.text("deleted"));
      const res = await req(app, "/items/7", { method: "DELETE" });
      expect(await res.text()).toBe("deleted");
    });

    test("PATCH", async () => {
      const app = new App();
      app.patch("/items/:id", (ctx) => ctx.json({ patched: true }));
      const res = await req(app, "/items/1", { method: "PATCH" });
      expect(await res.json()).toEqual({ patched: true });
    });
  });

  describe("404 handling", () => {
    test("returns default 404 for unknown route", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.text("home"));
      const res = await req(app, "/nope");
      expect(res.status).toBe(404);
    });

    test("custom notFound handler", async () => {
      const app = new App();
      app.notFound((ctx) => ctx.json({ custom: "not found" }, 404));
      const res = await req(app, "/nope");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ custom: "not found" });
    });
  });

  describe("error handling", () => {
    test("default error handler returns 500", async () => {
      const app = new App();
      app.get("/boom", () => {
        throw new Error("kaboom");
      });
      const res = await req(app, "/boom");
      expect(res.status).toBe(500);
    });

    test("custom error handler", async () => {
      const app = new App();
      app.onError((err, ctx) => ctx.json({ error: String(err) }, 500));
      app.get("/boom", () => {
        throw new Error("kaboom");
      });
      const res = await req(app, "/boom");
      expect(res.status).toBe(500);
      expect((await res.json() as any).error).toContain("kaboom");
    });

    test("returns 400 with issues for ValidationError", async () => {
      const app = new App();
      const schema = v.object({ name: v.string() });
      app.post("/users", async (ctx) => {
        const data = await ctx.body(schema);
        return ctx.json(data, 201);
      });
      const res = await req(app, "/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error).toBe("Validation failed");
      expect(json.issues).toBeInstanceOf(Array);
      expect(json.issues[0].path).toBe("name");
    });
  });

  describe("request id and route path", () => {
    test("ctx.id is available in handlers", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.json({ id: ctx.id }));
      const res = await req(app, "/");
      const json = (await res.json()) as any;
      expect(json.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test("ctx.routePath is the pattern, not the actual path", async () => {
      const app = new App();
      app.get("/users/:id", (ctx) => ctx.json({ routePath: ctx.routePath }));
      const res = await req(app, "/users/42");
      expect(await res.json()).toEqual({ routePath: "/users/:id" });
    });

    test("ctx.routePath is set for static routes", async () => {
      const app = new App();
      app.get("/health", (ctx) => ctx.json({ routePath: ctx.routePath }));
      const res = await req(app, "/health");
      expect(await res.json()).toEqual({ routePath: "/health" });
    });

    test("ctx.routePath is null for unmatched routes", async () => {
      const app = new App();
      app.notFound((ctx) => ctx.json({ routePath: ctx.routePath }, 404));
      const res = await req(app, "/nope");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ routePath: null });
    });

    test("ctx.routePath is available in error handler", async () => {
      const app = new App();
      app.onError((err, ctx) =>
        ctx.json({ routePath: ctx.routePath, id: ctx.id }, 500),
      );
      app.get("/users/:id", () => {
        throw new Error("boom");
      });
      const res = await req(app, "/users/42");
      expect(res.status).toBe(500);
      const json = (await res.json()) as any;
      expect(json.routePath).toBe("/users/:id");
      expect(json.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test("ctx.routePath works with groups", async () => {
      const app = new App();
      const api = app.group("/api");
      api.get("/users/:id", (ctx) => ctx.json({ routePath: ctx.routePath }));
      const res = await req(app, "/api/users/42");
      expect(await res.json()).toEqual({ routePath: "/api/users/:id" });
    });
  });

  describe("query/param validation", () => {
    test("returns 400 on invalid query param", async () => {
      const app = new App();
      app.get("/items", (ctx) => {
        const { page } = ctx.validQuery(
          v.object({ page: v.coerce.number().min(1) }),
        );
        return ctx.json({ page });
      });
      const res = await req(app, "/items?page=abc");
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error).toBe("Validation failed");
    });

    test("returns coerced query values on success", async () => {
      const app = new App();
      app.get("/items", (ctx) => {
        const { page, limit } = ctx.validQuery(
          v.object({
            page: v.coerce.number().min(1),
            limit: v.coerce.number().max(100),
          }),
        );
        return ctx.json({ page, limit });
      });
      const res = await req(app, "/items?page=2&limit=20");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ page: 2, limit: 20 });
    });

    test("returns 400 on invalid route param", async () => {
      const app = new App();
      app.get("/users/:id", (ctx) => {
        const { id } = ctx.validParams(
          v.object({ id: v.coerce.number().integer() }),
        );
        return ctx.json({ id });
      });
      const res = await req(app, "/users/abc");
      expect(res.status).toBe(400);
    });

    test("returns coerced route param on success", async () => {
      const app = new App();
      app.get("/users/:id", (ctx) => {
        const { id } = ctx.validParams(
          v.object({ id: v.coerce.number() }),
        );
        return ctx.json({ id });
      });
      const res = await req(app, "/users/42");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 42 });
    });
  });

  describe("middleware", () => {
    test("global middleware runs on all routes", async () => {
      const app = new App();
      app.use(async (ctx, next) => {
        const res = await next();
        return new Response(res.body, {
          status: res.status,
          headers: { ...Object.fromEntries(res.headers), "X-Middleware": "ran" },
        });
      });
      app.get("/", (ctx) => ctx.text("ok"));
      const res = await req(app, "/");
      expect(res.headers.get("x-middleware")).toBe("ran");
    });

    test("scoped middleware only runs on matching paths", async () => {
      const app = new App();
      app.use("/api", async (ctx, next) => {
        const res = await next();
        return new Response(res.body, {
          status: res.status,
          headers: { ...Object.fromEntries(res.headers), "X-Scoped": "yes" },
        });
      });
      app.get("/api/data", (ctx) => ctx.text("data"));
      app.get("/other", (ctx) => ctx.text("other"));

      const apiRes = await req(app, "/api/data");
      expect(apiRes.headers.get("x-scoped")).toBe("yes");

      const otherRes = await req(app, "/other");
      expect(otherRes.headers.get("x-scoped")).toBeNull();
    });

    test("middleware executes in order", async () => {
      const app = new App();
      const order: string[] = [];

      app.use(async (_ctx, next) => {
        order.push("a-before");
        const res = await next();
        order.push("a-after");
        return res;
      });
      app.use(async (_ctx, next) => {
        order.push("b-before");
        const res = await next();
        order.push("b-after");
        return res;
      });
      app.get("/", (ctx) => {
        order.push("handler");
        return ctx.text("ok");
      });

      await req(app, "/");
      expect(order).toEqual(["a-before", "b-before", "handler", "b-after", "a-after"]);
    });
  });

  describe("route-level middleware", () => {
    test("runs middleware attached to a specific route", async () => {
      const app = new App();
      const auth: Middleware = async (ctx, next) => {
        if (!ctx.headers.get("authorization")) {
          return ctx.json({ error: "Unauthorized" }, 401);
        }
        return next();
      };

      app.get("/admin", auth, (ctx) => ctx.text("secret"));
      app.get("/public", (ctx) => ctx.text("open"));

      const denied = await req(app, "/admin");
      expect(denied.status).toBe(401);

      const allowed = await req(app, "/admin", {
        headers: { Authorization: "Bearer token" },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.text()).toBe("secret");

      const pub = await req(app, "/public");
      expect(pub.status).toBe(200);
      expect(await pub.text()).toBe("open");
    });

    test("chains multiple route-level middleware in order", async () => {
      const app = new App();
      const order: string[] = [];

      const m1: Middleware = async (_ctx, next) => {
        order.push("m1-before");
        const res = await next();
        order.push("m1-after");
        return res;
      };
      const m2: Middleware = async (_ctx, next) => {
        order.push("m2-before");
        const res = await next();
        order.push("m2-after");
        return res;
      };

      app.get("/test", m1, m2, (ctx) => {
        order.push("handler");
        return ctx.text("ok");
      });

      await req(app, "/test");
      expect(order).toEqual(["m1-before", "m2-before", "handler", "m2-after", "m1-after"]);
    });

    test("route middleware runs after global middleware", async () => {
      const app = new App();
      const order: string[] = [];

      app.use(async (_ctx, next) => {
        order.push("global");
        return next();
      });

      const routeMw: Middleware = async (_ctx, next) => {
        order.push("route");
        return next();
      };

      app.get("/test", routeMw, (ctx) => {
        order.push("handler");
        return ctx.text("ok");
      });

      await req(app, "/test");
      expect(order).toEqual(["global", "route", "handler"]);
    });

    test("route middleware does not leak to other routes", async () => {
      const app = new App();
      const tagged: Middleware = async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Tagged", "yes");
        return res;
      };

      app.get("/tagged", tagged, (ctx) => ctx.text("tagged"));
      app.get("/plain", (ctx) => ctx.text("plain"));

      const taggedRes = await req(app, "/tagged");
      expect(taggedRes.headers.get("x-tagged")).toBe("yes");

      const plainRes = await req(app, "/plain");
      expect(plainRes.headers.get("x-tagged")).toBeNull();
    });

    test("works with all HTTP methods", async () => {
      const app = new App();
      const mw: Middleware = async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Route-MW", "yes");
        return res;
      };

      app.post("/data", mw, async (ctx) => {
        const body = await ctx.body();
        return ctx.json(body, 201);
      });
      app.put("/data/:id", mw, (ctx) => ctx.json({ updated: ctx.params.id }));
      app.delete("/data/:id", mw, (ctx) => ctx.text("deleted"));
      app.patch("/data/:id", mw, (ctx) => ctx.json({ patched: true }));

      const postRes = await req(app, "/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
      expect(postRes.status).toBe(201);
      expect(postRes.headers.get("x-route-mw")).toBe("yes");

      const putRes = await req(app, "/data/1", { method: "PUT" });
      expect(putRes.headers.get("x-route-mw")).toBe("yes");

      const delRes = await req(app, "/data/1", { method: "DELETE" });
      expect(delRes.headers.get("x-route-mw")).toBe("yes");

      const patchRes = await req(app, "/data/1", { method: "PATCH" });
      expect(patchRes.headers.get("x-route-mw")).toBe("yes");
    });

    test("works with all() method", async () => {
      const app = new App();
      const mw: Middleware = async (ctx, next) => {
        const res = await next();
        res.headers.set("X-All", "yes");
        return res;
      };

      app.all("/any", mw, (ctx) => ctx.text(ctx.method));

      const get = await req(app, "/any");
      expect(await get.text()).toBe("GET");
      expect(get.headers.get("x-all")).toBe("yes");

      const post = await req(app, "/any", { method: "POST" });
      expect(await post.text()).toBe("POST");
      expect(post.headers.get("x-all")).toBe("yes");
    });

    test("works with route groups", async () => {
      const app = new App();
      const mw: Middleware = async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Group-Route", "yes");
        return res;
      };

      const api = app.group("/api");
      api.get("/protected", mw, (ctx) => ctx.text("protected"));
      api.get("/open", (ctx) => ctx.text("open"));

      const protRes = await req(app, "/api/protected");
      expect(protRes.headers.get("x-group-route")).toBe("yes");

      const openRes = await req(app, "/api/open");
      expect(openRes.headers.get("x-group-route")).toBeNull();
    });

    test("route middleware can short-circuit", async () => {
      const app = new App();
      const block: Middleware = async (ctx, _next) => {
        return ctx.json({ error: "Blocked" }, 403);
      };

      app.get("/blocked", block, (ctx) => ctx.text("should not reach"));

      const res = await req(app, "/blocked");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Blocked" });
    });
  });

  describe("route groups", () => {
    test("group prefixes routes", async () => {
      const app = new App();
      const api = app.group("/api");
      api.get("/health", (ctx) => ctx.text("ok"));

      const res = await req(app, "/api/health");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    test("nested groups", async () => {
      const app = new App();
      const api = app.group("/api");
      const v1 = api.group("/v1");
      v1.get("/users", (ctx) => ctx.json([]));

      const res = await req(app, "/api/v1/users");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    test("group middleware does not leak to other routes", async () => {
      const app = new App();
      const api = app.group("/api");
      api.use(async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Api", "true");
        return res;
      });
      api.get("/data", (ctx) => ctx.text("api data"));
      app.get("/home", (ctx) => ctx.text("home"));

      const apiRes = await req(app, "/api/data");
      expect(apiRes.headers.get("x-api")).toBe("true");

      const homeRes = await req(app, "/home");
      expect(homeRes.headers.get("x-api")).toBeNull();
    });

    test("group middleware does not leak to sibling groups", async () => {
      const app = new App();
      const api = app.group("/api");
      const admin = app.group("/admin");

      api.use(async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Api", "true");
        return res;
      });
      admin.use(async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Admin", "true");
        return res;
      });

      api.get("/data", (ctx) => ctx.text("api"));
      admin.get("/dashboard", (ctx) => ctx.text("admin"));

      const apiRes = await req(app, "/api/data");
      expect(apiRes.headers.get("x-api")).toBe("true");
      expect(apiRes.headers.get("x-admin")).toBeNull();

      const adminRes = await req(app, "/admin/dashboard");
      expect(adminRes.headers.get("x-admin")).toBe("true");
      expect(adminRes.headers.get("x-api")).toBeNull();
    });

    test("parent global middleware still applies to group routes", async () => {
      const app = new App();
      app.use(async (ctx, next) => {
        const res = await next();
        res.headers.set("X-Global", "true");
        return res;
      });
      const api = app.group("/api");
      api.get("/data", (ctx) => ctx.text("data"));

      const res = await req(app, "/api/data");
      expect(res.headers.get("x-global")).toBe("true");
    });
  });

  describe("state passing", () => {
    test("middleware sets state, handler reads it", async () => {
      const app = new App();
      app.use(async (ctx, next) => {
        ctx.set("user", { id: 1, role: "admin" });
        return next();
      });
      app.get("/me", (ctx) => {
        const user = ctx.get("user") as { id: number; role: string } | undefined;
        return ctx.json(user);
      });

      const res = await req(app, "/me");
      expect(await res.json()).toEqual({ id: 1, role: "admin" });
    });

    test("state is isolated per request", async () => {
      const app = new App();
      let counter = 0;
      app.use(async (ctx, next) => {
        ctx.set("reqId", ++counter);
        return next();
      });
      app.get("/id", (ctx) => ctx.json({ id: ctx.get("reqId") }));

      const res1 = await req(app, "/id");
      const res2 = await req(app, "/id");
      expect(await res1.json()).toEqual({ id: 1 });
      expect(await res2.json()).toEqual({ id: 2 });
    });

    test("chained middleware passes state downstream", async () => {
      const app = new App();
      app.use(async (ctx, next) => {
        ctx.set("step", "a");
        return next();
      });
      app.use(async (ctx, next) => {
        ctx.set("step", ctx.get("step") + "b");
        return next();
      });
      app.get("/", (ctx) => ctx.text(ctx.get("step") as string));

      const res = await req(app, "/");
      expect(await res.text()).toBe("ab");
    });
  });

  describe("cookies", () => {
    test("middleware sets cookie, handler reads it from response", async () => {
      const app = new App();
      app.use(async (ctx, next) => {
        ctx.setCookie("tracker", "abc", { httpOnly: true, path: "/" });
        return next();
      });
      app.get("/", (ctx) => ctx.json({ ok: true }));

      const res = await req(app, "/");
      expect(res.status).toBe(200);
      const cookie = res.headers.get("set-cookie");
      expect(cookie).toContain("tracker=abc");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
    });
  });

  describe("all()", () => {
    test("registers route for multiple methods", async () => {
      const app = new App();
      app.all("/any", (ctx) => ctx.text(ctx.method));

      const get = await req(app, "/any");
      expect(await get.text()).toBe("GET");

      const post = await req(app, "/any", { method: "POST" });
      expect(await post.text()).toBe("POST");

      const put = await req(app, "/any", { method: "PUT" });
      expect(await put.text()).toBe("PUT");
    });
  });

  describe("request()", () => {
    test("accepts a path string", async () => {
      const app = new App();
      app.get("/hello", (ctx) => ctx.text("world"));
      const res = await app.request("/hello");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("world");
    });

    test("accepts a full URL", async () => {
      const app = new App();
      app.get("/hello", (ctx) => ctx.text("world"));
      const res = await app.request("http://example.com/hello");
      expect(await res.text()).toBe("world");
    });

    test("accepts a Request object", async () => {
      const app = new App();
      app.post("/data", async (ctx) => {
        const body = await ctx.body();
        return ctx.json(body, 201);
      });
      const res = await app.request(
        new Request("http://localhost/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true }),
        }),
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("accepts RequestInit options", async () => {
      const app = new App();
      app.delete("/item", (ctx) => ctx.text("deleted"));
      const res = await app.request("/item", { method: "DELETE" });
      expect(await res.text()).toBe("deleted");
    });
  });

  describe("static()", () => {
    test("serves a file", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/style.css");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("body { color: red; }\n");
    });

    test("serves index.html at directory root", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<h1>Hello</h1>\n");
    });

    test("serves files in subdirectories", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/sub/page.html");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<h1>Sub</h1>\n");
    });

    test("returns 404 for missing files", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/nope.txt");
      expect(res.status).toBe(404);
    });

    test("blocks path traversal", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/../../package.json");
      expect(res.status).not.toBe(200);
    });

    test("works with route groups", async () => {
      const app = new App();
      const assets = app.group("/assets");
      assets.static("/files", fixturesDir);
      const res = await app.request("/assets/files/style.css");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("body { color: red; }\n");
    });

    test("sets ETag, Last-Modified, and Cache-Control headers", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/style.css");
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toMatch(/^"[a-z0-9]+-[a-z0-9]+"$/);
      expect(res.headers.get("last-modified")).toBeTruthy();
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    });

    test("returns 304 for matching If-None-Match", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const first = await app.request("/public/style.css");
      const etag = first.headers.get("etag")!;

      const second = await app.request("/public/style.css", {
        headers: { "if-none-match": etag },
      });
      expect(second.status).toBe(304);
      expect(await second.text()).toBe("");
    });

    test("returns 304 for matching If-Modified-Since", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const first = await app.request("/public/style.css");
      const lastModified = first.headers.get("last-modified")!;

      const second = await app.request("/public/style.css", {
        headers: { "if-modified-since": lastModified },
      });
      expect(second.status).toBe(304);
    });

    test("returns 200 for stale If-Modified-Since", async () => {
      const app = new App();
      app.static("/public", fixturesDir);
      const res = await app.request("/public/style.css", {
        headers: { "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("named routes & url()", () => {
    test(".as() names a route and url() generates the path", () => {
      const app = new App();
      app.get("/users", (ctx) => ctx.text("list")).as("user.list");
      expect(app.url("user.list")).toBe("/users");
    });

    test("param substitution", () => {
      const app = new App();
      app.get("/users/:id", (ctx) => ctx.text("show")).as("user.show");
      expect(app.url("user.show", { id: "123" })).toBe("/users/123");
    });

    test("wildcard substitution", () => {
      const app = new App();
      app.get("/files/*", (ctx) => ctx.text("file")).as("files");
      expect(app.url("files", { "*": "a/b/c" })).toBe("/files/a/b/c");
    });

    test("groups: naming routes on sub-app, generating from parent", () => {
      const app = new App();
      const api = app.group("/api");
      api.get("/posts/:id", (ctx) => ctx.text("post")).as("api.post");
      expect(app.url("api.post", { id: "5" })).toBe("/api/posts/5");
    });

    test("throws on unknown route name", () => {
      const app = new App();
      expect(() => app.url("nope")).toThrow('Unknown route name "nope"');
    });

    test("throws on missing required param", () => {
      const app = new App();
      app.get("/users/:id", (ctx) => ctx.text("show")).as("user.show");
      expect(() => app.url("user.show")).toThrow('Missing param "id"');
    });

    test("throws on duplicate name", () => {
      const app = new App();
      app.get("/a", (ctx) => ctx.text("a")).as("route");
      expect(() => {
        app.get("/b", (ctx) => ctx.text("b")).as("route");
      }).toThrow('Route name "route" is already defined');
    });
  });

  describe("close()", () => {
    test("resolves immediately when server is not started", async () => {
      const app = new App();
      await app.close();
      expect(app.server).toBeNull();
    });

    test("stops a running server", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.text("ok"));
      app.listen(0);
      expect(app.server).not.toBeNull();

      const port = app.server!.port;
      const res = await fetch(`http://localhost:${port}/`);
      expect(await res.text()).toBe("ok");

      await app.close();
      expect(app.server).toBeNull();
    });

    test("is idempotent", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.text("ok"));
      app.listen(0);

      await app.close();
      await app.close();
      expect(app.server).toBeNull();
    });

    test("force-closes with closeActive=true", async () => {
      const app = new App();
      app.get("/", (ctx) => ctx.text("ok"));
      app.listen(0);

      await app.close(true);
      expect(app.server).toBeNull();
    });
  });

  describe("typed vars", () => {
    type Vars = { user: { id: number; role: string }; requestId: string };

    test("typed set/get with App<Vars>", async () => {
      const app = new App<Vars>();
      app.use(async (ctx, next) => {
        ctx.set("user", { id: 1, role: "admin" });
        ctx.set("requestId", "req-123");
        return next();
      });
      app.get("/me", (ctx) => {
        const user = ctx.get("user");
        const rid = ctx.get("requestId");
        return ctx.json({ user, rid });
      });

      const res = await req(app, "/me");
      expect(await res.json()).toEqual({
        user: { id: 1, role: "admin" },
        rid: "req-123",
      });
    });

    test("ctx.var property access", async () => {
      const app = new App<Vars>();
      app.use(async (ctx, next) => {
        ctx.set("user", { id: 42, role: "user" });
        ctx.set("requestId", "abc");
        return next();
      });
      app.get("/me", (ctx) => {
        return ctx.json({
          id: ctx.var.user?.id,
          role: ctx.var.user?.role,
          rid: ctx.var.requestId,
        });
      });

      const res = await req(app, "/me");
      expect(await res.json()).toEqual({ id: 42, role: "user", rid: "abc" });
    });

    test("ctx.var reflects latest state", async () => {
      const app = new App<Vars>();
      app.use(async (ctx, next) => {
        ctx.set("requestId", "first");
        ctx.set("requestId", "second");
        return next();
      });
      app.get("/", (ctx) => ctx.text(ctx.var.requestId!));

      const res = await req(app, "/");
      expect(await res.text()).toBe("second");
    });

    test("groups preserve vars type", async () => {
      const app = new App<Vars>();
      const api = app.group("/api");
      api.use(async (ctx, next) => {
        ctx.set("user", { id: 5, role: "mod" });
        return next();
      });
      api.get("/me", (ctx) => ctx.json(ctx.var.user));

      const res = await req(app, "/api/me");
      expect(await res.json()).toEqual({ id: 5, role: "mod" });
    });

    test("get returns undefined for unset key", async () => {
      const app = new App<Vars>();
      app.get("/", (ctx) => ctx.json({ user: ctx.get("user") }));

      const res = await req(app, "/");
      expect(await res.json()).toEqual({});
    });
  });
});
