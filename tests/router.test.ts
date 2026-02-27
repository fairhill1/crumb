import { describe, test, expect } from "bun:test";
import { Router } from "../src/router";
import type { Context } from "../src/context";

const noop = (() => new Response()) as any;
const handler = (tag: string) => {
  const fn = (() => new Response(tag)) as any;
  fn._tag = tag;
  return fn;
};

describe("Router", () => {
  describe("static routes", () => {
    test("matches root", () => {
      const r = new Router();
      r.add("GET", "/", noop);
      expect(r.match("GET", "http://localhost/")).not.toBeNull();
    });

    test("matches simple path", () => {
      const r = new Router();
      r.add("GET", "/users", noop);
      expect(r.match("GET", "http://localhost/users")).not.toBeNull();
    });

    test("matches nested path", () => {
      const r = new Router();
      r.add("GET", "/api/v1/health", noop);
      expect(r.match("GET", "http://localhost/api/v1/health")).not.toBeNull();
    });

    test("returns null for unregistered path", () => {
      const r = new Router();
      r.add("GET", "/users", noop);
      expect(r.match("GET", "http://localhost/posts")).toBeNull();
    });

    test("distinguishes between methods", () => {
      const r = new Router();
      const get = handler("get");
      const post = handler("post");
      r.add("GET", "/users", get);
      r.add("POST", "/users", post);

      expect(r.match("GET", "http://localhost/users")!.handler).toBe(get);
      expect(r.match("POST", "http://localhost/users")!.handler).toBe(post);
    });

    test("returns null for wrong method", () => {
      const r = new Router();
      r.add("GET", "/users", noop);
      expect(r.match("POST", "http://localhost/users")).toBeNull();
    });

    test("method matching is case-insensitive", () => {
      const r = new Router();
      r.add("get", "/users", noop);
      expect(r.match("GET", "http://localhost/users")).not.toBeNull();
      expect(r.match("get", "http://localhost/users")).not.toBeNull();
    });
  });

  describe("param routes", () => {
    test("captures single param", () => {
      const r = new Router();
      r.add("GET", "/users/:id", noop);
      const result = r.match("GET", "http://localhost/users/42");
      expect(result).not.toBeNull();
      expect(result!.params).toEqual({ id: "42" });
    });

    test("captures multiple params", () => {
      const r = new Router();
      r.add("GET", "/users/:userId/posts/:postId", noop);
      const result = r.match("GET", "http://localhost/users/5/posts/99");
      expect(result).not.toBeNull();
      expect(result!.params).toEqual({ userId: "5", postId: "99" });
    });

    test("returns empty params for static routes", () => {
      const r = new Router();
      r.add("GET", "/users", noop);
      const result = r.match("GET", "http://localhost/users");
      expect(result!.params).toEqual({});
    });

    test("param does not match empty segment", () => {
      const r = new Router();
      r.add("GET", "/users/:id", noop);
      // /users/ has no second segment, should not match /users/:id
      expect(r.match("GET", "http://localhost/users/")).toBeNull();
    });
  });

  describe("wildcard routes", () => {
    test("matches wildcard", () => {
      const r = new Router();
      r.add("GET", "/files/*", noop);
      expect(r.match("GET", "http://localhost/files/a")).not.toBeNull();
      expect(r.match("GET", "http://localhost/files/a/b/c")).not.toBeNull();
    });

    test("wildcard does not match parent", () => {
      const r = new Router();
      r.add("GET", "/files/*", noop);
      expect(r.match("GET", "http://localhost/files")).toBeNull();
    });
  });

  describe("static vs param priority", () => {
    test("prefers static over param", () => {
      const r = new Router();
      const staticH = handler("static");
      const paramH = handler("param");
      r.add("GET", "/users/me", staticH);
      r.add("GET", "/users/:id", paramH);

      expect(r.match("GET", "http://localhost/users/me")!.handler).toBe(staticH);
      expect(r.match("GET", "http://localhost/users/42")!.handler).toBe(paramH);
    });
  });

  describe("trailing slashes", () => {
    test("route without trailing slash does not match url with trailing slash", () => {
      const r = new Router();
      r.add("GET", "/users", noop);
      // trailing slash produces empty segment which is stripped, so /users/ == /users
      expect(r.match("GET", "http://localhost/users/")).not.toBeNull();
    });

    test("route with trailing slash matches url without trailing slash", () => {
      const r = new Router();
      r.add("GET", "/users/", noop);
      expect(r.match("GET", "http://localhost/users")).not.toBeNull();
    });
  });

  describe("URL parsing", () => {
    test("handles full URLs", () => {
      const r = new Router();
      r.add("GET", "/test", noop);
      expect(r.match("GET", "http://example.com/test")).not.toBeNull();
      expect(r.match("GET", "https://example.com:8080/test")).not.toBeNull();
    });

    test("strips query string", () => {
      const r = new Router();
      r.add("GET", "/search", noop);
      expect(r.match("GET", "http://localhost/search?q=foo")).not.toBeNull();
    });

    test("handles bare pathnames", () => {
      const r = new Router();
      r.add("GET", "/test", noop);
      expect(r.match("GET", "/test")).not.toBeNull();
      expect(r.match("GET", "/test?q=1")).not.toBeNull();
    });

    test("handles URL with no path", () => {
      const r = new Router();
      r.add("GET", "/", noop);
      expect(r.match("GET", "http://localhost")).not.toBeNull();
    });
  });

  describe("multiple methods on same path", () => {
    test("stores and retrieves different handlers per method", () => {
      const r = new Router();
      const g = handler("GET");
      const p = handler("POST");
      const d = handler("DELETE");
      r.add("GET", "/items/:id", g);
      r.add("POST", "/items/:id", p);
      r.add("DELETE", "/items/:id", d);

      expect(r.match("GET", "http://localhost/items/1")!.handler).toBe(g);
      expect(r.match("POST", "http://localhost/items/1")!.handler).toBe(p);
      expect(r.match("DELETE", "http://localhost/items/1")!.handler).toBe(d);
      expect(r.match("PATCH", "http://localhost/items/1")).toBeNull();
    });
  });
});
