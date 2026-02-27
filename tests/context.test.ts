import { describe, test, expect } from "bun:test";
import { Context } from "../src/context";
import { v, ValidationError } from "../src/validator";

function makeCtx(url: string, init?: RequestInit) {
  return new Context(new Request(url, init));
}

describe("Context", () => {
  describe("request properties", () => {
    test("method", () => {
      expect(makeCtx("http://localhost/", { method: "POST" }).method).toBe("POST");
    });

    test("path", () => {
      expect(makeCtx("http://localhost/users/42").path).toBe("/users/42");
    });

    test("query", () => {
      const ctx = makeCtx("http://localhost/search?q=bun&page=2");
      expect(ctx.query.get("q")).toBe("bun");
      expect(ctx.query.get("page")).toBe("2");
    });

    test("headers", () => {
      const ctx = makeCtx("http://localhost/", {
        headers: { "X-Custom": "value" },
      });
      expect(ctx.headers.get("x-custom")).toBe("value");
    });

    test("params default to empty object", () => {
      expect(makeCtx("http://localhost/").params).toEqual({});
    });

    test("params can be set", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.params = { id: "42" };
      expect(ctx.params.id).toBe("42");
    });

    test("id is a valid UUID", () => {
      const ctx = makeCtx("http://localhost/");
      expect(ctx.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test("id is unique per context", () => {
      const a = makeCtx("http://localhost/");
      const b = makeCtx("http://localhost/");
      expect(a.id).not.toBe(b.id);
    });

    test("id can be overridden", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.id = "custom-id";
      expect(ctx.id).toBe("custom-id");
    });

    test("routePath defaults to null", () => {
      const ctx = makeCtx("http://localhost/");
      expect(ctx.routePath).toBeNull();
    });
  });

  describe("body parsing", () => {
    test("body() parses JSON", async () => {
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alice" }),
      });
      const body = await ctx.body<{ name: string }>();
      expect(body.name).toBe("alice");
    });

    test("bodyText() returns raw text", async () => {
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        body: "hello world",
      });
      expect(await ctx.bodyText()).toBe("hello world");
    });

    test("formData() parses multipart form", async () => {
      const form = new FormData();
      form.append("name", "alice");
      form.append("age", "30");
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        body: form,
      });
      const data = await ctx.formData();
      expect(data.get("name")).toBe("alice");
      expect(data.get("age")).toBe("30");
    });

    test("arrayBuffer() returns raw bytes", async () => {
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        body: "binary data",
      });
      const buf = await ctx.arrayBuffer();
      expect(buf).toBeInstanceOf(ArrayBuffer);
      expect(new TextDecoder().decode(buf)).toBe("binary data");
    });

    test("blob() returns a Blob", async () => {
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        body: "blob content",
      });
      const b = await ctx.blob();
      expect(b).toBeInstanceOf(Blob);
      expect(await b.text()).toBe("blob content");
    });

    test("body(schema) validates JSON", async () => {
      const schema = v.object({ name: v.string(), age: v.number() });
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alice", age: 30 }),
      });
      const data = await ctx.body(schema);
      expect(data).toEqual({ name: "alice", age: 30 });
    });

    test("body(schema) throws ValidationError on invalid data", async () => {
      const schema = v.object({ name: v.string() });
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      });
      try {
        await ctx.body(schema);
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
      }
    });

    test("body() without schema still works", async () => {
      const ctx = makeCtx("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
      const data = await ctx.body();
      expect(data).toEqual({ ok: true });
    });
  });

  describe("response helpers", () => {
    test("json()", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.json({ ok: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ ok: true });
    });

    test("json() with status", () => {
      const res = makeCtx("http://localhost/").json({ error: "nope" }, 404);
      expect(res.status).toBe(404);
    });

    test("text()", async () => {
      const res = makeCtx("http://localhost/").text("hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(await res.text()).toBe("hello");
    });

    test("html()", async () => {
      const res = makeCtx("http://localhost/").html("<h1>hi</h1>");
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(await res.text()).toBe("<h1>hi</h1>");
    });

    test("redirect()", () => {
      const res = makeCtx("http://localhost/").redirect("/login");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("redirect() with custom status", () => {
      const res = makeCtx("http://localhost/").redirect("/new", 301);
      expect(res.status).toBe(301);
    });

    test("status() sets default status", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.status(201);
      const res = ctx.json({ created: true });
      expect(res.status).toBe(201);
    });

    test("explicit status arg overrides status()", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.status(201);
      const res = ctx.json({ error: "bad" }, 400);
      expect(res.status).toBe(400);
    });

    test("header() sets response header", async () => {
      const ctx = makeCtx("http://localhost/");
      ctx.header("X-Request-Id", "abc123");
      const res = ctx.json({ ok: true });
      expect(res.headers.get("x-request-id")).toBe("abc123");
    });
  });

  describe("cookies", () => {
    test("cookie(name) reads a specific cookie", () => {
      const ctx = makeCtx("http://localhost/", {
        headers: { Cookie: "session=abc123; theme=dark" },
      });
      expect(ctx.cookie("session")).toBe("abc123");
      expect(ctx.cookie("theme")).toBe("dark");
    });

    test("cookie() returns all cookies", () => {
      const ctx = makeCtx("http://localhost/", {
        headers: { Cookie: "a=1; b=2" },
      });
      expect(ctx.cookie()).toEqual({ a: "1", b: "2" });
    });

    test("cookie(name) returns undefined when no Cookie header", () => {
      const ctx = makeCtx("http://localhost/");
      expect(ctx.cookie("missing")).toBeUndefined();
    });

    test("cookie() returns empty object when no Cookie header", () => {
      const ctx = makeCtx("http://localhost/");
      expect(ctx.cookie()).toEqual({});
    });

    test("setCookie() basic", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.setCookie("token", "xyz");
      const res = ctx.text("ok");
      expect(res.headers.get("set-cookie")).toBe("token=xyz");
    });

    test("setCookie() with all options", () => {
      const ctx = makeCtx("http://localhost/");
      const expires = new Date("2026-12-31T00:00:00Z");
      ctx.setCookie("id", "42", {
        domain: "example.com",
        path: "/",
        maxAge: 3600,
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      });
      const res = ctx.text("ok");
      const header = res.headers.get("set-cookie")!;
      expect(header).toContain("id=42");
      expect(header).toContain("Domain=example.com");
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=3600");
      expect(header).toContain(`Expires=${expires.toUTCString()}`);
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
      expect(header).toContain("SameSite=Strict");
    });

    test("multiple setCookie() calls produce multiple Set-Cookie headers", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.setCookie("a", "1");
      ctx.setCookie("b", "2");
      const res = ctx.json({ ok: true });
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies[0]).toBe("a=1");
      expect(cookies[1]).toBe("b=2");
    });

    test("deleteCookie() sets Max-Age=0", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.deleteCookie("session");
      const res = ctx.text("ok");
      expect(res.headers.get("set-cookie")).toBe("session=; Max-Age=0");
    });

    test("deleteCookie() with domain and path", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.deleteCookie("session", { domain: "example.com", path: "/" });
      const res = ctx.text("ok");
      const header = res.headers.get("set-cookie")!;
      expect(header).toContain("Domain=example.com");
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=0");
    });

    test("setCookie and deleteCookie are chainable", () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx
        .setCookie("a", "1")
        .setCookie("b", "2")
        .deleteCookie("c")
        .json({ ok: true });
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(3);
    });
  });

  describe("state", () => {
    test("set and get a value", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.set("user", { id: 1, name: "alice" });
      expect(ctx.get("user")).toEqual({ id: 1, name: "alice" });
    });

    test("get returns undefined for missing key", () => {
      const ctx = makeCtx("http://localhost/");
      expect(ctx.get("missing")).toBeUndefined();
    });

    test("get with type parameter", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.set("count", 42);
      expect(ctx.get("count")).toBe(42);
    });

    test("overwrite existing value", () => {
      const ctx = makeCtx("http://localhost/");
      ctx.set("key", "first");
      ctx.set("key", "second");
      expect(ctx.get("key")).toBe("second");
    });
  });

  describe("validQuery()", () => {
    test("validates and coerces query params", () => {
      const ctx = makeCtx("http://localhost/search?page=2&limit=10");
      const result = ctx.validQuery(
        v.object({ page: v.coerce.number(), limit: v.coerce.number() }),
      );
      expect(result).toEqual({ page: 2, limit: 10 });
    });

    test("throws ValidationError on invalid query", () => {
      const ctx = makeCtx("http://localhost/search?page=abc");
      expect(() =>
        ctx.validQuery(v.object({ page: v.coerce.number() })),
      ).toThrow(ValidationError);
    });

    test("handles optional query params", () => {
      const ctx = makeCtx("http://localhost/search?q=hello");
      const result = ctx.validQuery(
        v.object({
          q: v.string(),
          page: v.coerce.number().optional(),
        }),
      );
      expect(result).toEqual({ q: "hello" });
    });

    test("first value wins for duplicate keys", () => {
      const ctx = makeCtx("http://localhost/search?tag=a&tag=b");
      const result = ctx.validQuery(v.object({ tag: v.string() }));
      expect(result).toEqual({ tag: "a" });
    });

    test("coerces boolean query param", () => {
      const ctx = makeCtx("http://localhost/search?active=true");
      const result = ctx.validQuery(
        v.object({ active: v.coerce.boolean() }),
      );
      expect(result).toEqual({ active: true });
    });
  });

  describe("validParams()", () => {
    test("validates and coerces route params", () => {
      const ctx = makeCtx("http://localhost/users/42");
      ctx.params = { id: "42" };
      const result = ctx.validParams(
        v.object({ id: v.coerce.number() }),
      );
      expect(result).toEqual({ id: 42 });
    });

    test("throws ValidationError on invalid params", () => {
      const ctx = makeCtx("http://localhost/users/abc");
      ctx.params = { id: "abc" };
      expect(() =>
        ctx.validParams(v.object({ id: v.coerce.number().integer() })),
      ).toThrow(ValidationError);
    });

    test("string params pass through without coercion schema", () => {
      const ctx = makeCtx("http://localhost/users/alice");
      ctx.params = { name: "alice" };
      const result = ctx.validParams(
        v.object({ name: v.string().min(1) }),
      );
      expect(result).toEqual({ name: "alice" });
    });
  });

  describe("stream()", () => {
    test("returns readable response with chunks", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write("hello ");
        await stream.write("world");
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("hello world");
    });

    test("supports Uint8Array chunks", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write(new TextEncoder().encode("binary"));
      });
      expect(await res.text()).toBe("binary");
    });

    test("respects custom status", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write("ok");
      }, 201);
      expect(res.status).toBe(201);
    });

    test("respects ctx.status()", async () => {
      const ctx = makeCtx("http://localhost/");
      ctx.status(206);
      const res = ctx.stream(async (stream) => {
        await stream.write("partial");
      });
      expect(res.status).toBe(206);
    });

    test("respects ctx.header()", async () => {
      const ctx = makeCtx("http://localhost/");
      ctx.header("X-Stream", "yes");
      const res = ctx.stream(async (stream) => {
        await stream.write("data");
      });
      expect(res.headers.get("x-stream")).toBe("yes");
    });

    test("auto-closes after callback completes", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write("done");
      });
      const text = await res.text();
      expect(text).toBe("done");
    });

    test("explicit close stops the stream", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write("before");
        await stream.close();
      });
      expect(await res.text()).toBe("before");
    });

    test("write after close is a no-op", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async (stream) => {
        await stream.write("data");
        await stream.close();
        await stream.write("ignored");
      });
      expect(await res.text()).toBe("data");
    });

    test("abort on callback error", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.stream(async () => {
        throw new Error("fail");
      });
      try {
        await res.text();
      } catch {
        // stream was aborted — error is expected
      }
    });
  });

  describe("sse()", () => {
    test("sends basic event", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "hello" });
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("connection")).toBe("keep-alive");
      expect(await res.text()).toBe("data: hello\n\n");
    });

    test("sends event with all fields", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({
          id: "1",
          event: "update",
          retry: 5000,
          data: "payload",
        });
      });
      const text = await res.text();
      expect(text).toBe("id: 1\nevent: update\nretry: 5000\ndata: payload\n\n");
    });

    test("handles multiline data", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "line1\nline2\nline3" });
      });
      expect(await res.text()).toBe("data: line1\ndata: line2\ndata: line3\n\n");
    });

    test("sends multiple events", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "first" });
        await stream.sendEvent({ data: "second" });
      });
      expect(await res.text()).toBe("data: first\n\ndata: second\n\n");
    });

    test("respects ctx.header()", async () => {
      const ctx = makeCtx("http://localhost/");
      ctx.header("X-SSE", "true");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "ok" });
      });
      expect(res.headers.get("x-sse")).toBe("true");
    });

    test("respects custom status", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "ok" });
      }, 201);
      expect(res.status).toBe(201);
    });

    test("close stops the stream", async () => {
      const ctx = makeCtx("http://localhost/");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "last" });
        await stream.close();
      });
      expect(await res.text()).toBe("data: last\n\n");
    });

    test("includes cookies in response", async () => {
      const ctx = makeCtx("http://localhost/");
      ctx.setCookie("session", "abc");
      const res = ctx.sse(async (stream) => {
        await stream.sendEvent({ data: "ok" });
      });
      expect(res.headers.get("set-cookie")).toBe("session=abc");
    });
  });
});
