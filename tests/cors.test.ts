import { describe, test, expect } from "bun:test";
import { App } from "../src/app";
import { cors } from "../src/cors";

function req(app: App, path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init);
}

describe("cors middleware", () => {
  describe("default options (origin: *)", () => {
    test("adds Access-Control-Allow-Origin to GET response", async () => {
      const app = new App();
      app.use(cors());
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://example.com" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    test("handles preflight OPTIONS request", async () => {
      const app = new App();
      app.use(cors());
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    test("reflects Access-Control-Request-Headers when allowHeaders not set", async () => {
      const app = new App();
      app.use(cors());
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: {
          Origin: "http://example.com",
          "Access-Control-Request-Headers": "X-Custom, Authorization",
        },
      });
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "X-Custom, Authorization",
      );
    });
  });

  describe("specific origin", () => {
    test("allows matching origin", async () => {
      const app = new App();
      app.use(cors({ origin: "http://example.com" }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://example.com",
      );
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    test("does not add CORS headers for non-matching origin", async () => {
      const app = new App();
      app.use(cors({ origin: "http://example.com" }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://evil.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("array of origins", () => {
    test("allows listed origin", async () => {
      const app = new App();
      app.use(cors({ origin: ["http://a.com", "http://b.com"] }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://b.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://b.com");
    });

    test("rejects unlisted origin", async () => {
      const app = new App();
      app.use(cors({ origin: ["http://a.com", "http://b.com"] }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://c.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("function origin", () => {
    test("allows when function returns true", async () => {
      const app = new App();
      app.use(cors({ origin: (o) => o.endsWith(".example.com") }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://app.example.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://app.example.com",
      );
    });

    test("rejects when function returns false", async () => {
      const app = new App();
      app.use(cors({ origin: (o) => o.endsWith(".example.com") }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://evil.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("credentials", () => {
    test("sets Access-Control-Allow-Credentials header", async () => {
      const app = new App();
      app.use(cors({ origin: "http://example.com", credentials: true }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    test("sets credentials on preflight", async () => {
      const app = new App();
      app.use(cors({ origin: "http://example.com", credentials: true }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });
  });

  describe("maxAge", () => {
    test("sets Access-Control-Max-Age on preflight", async () => {
      const app = new App();
      app.use(cors({ maxAge: 3600 }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Max-Age")).toBe("3600");
    });
  });

  describe("exposeHeaders", () => {
    test("sets Access-Control-Expose-Headers on actual request", async () => {
      const app = new App();
      app.use(cors({ exposeHeaders: ["X-Request-Id", "X-Total-Count"] }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Request-Id, X-Total-Count",
      );
    });
  });

  describe("custom allowHeaders", () => {
    test("sets specified Access-Control-Allow-Headers on preflight", async () => {
      const app = new App();
      app.use(cors({ allowHeaders: ["Content-Type", "Authorization"] }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type, Authorization",
      );
    });
  });

  describe("custom allowMethods", () => {
    test("sets specified Access-Control-Allow-Methods on preflight", async () => {
      const app = new App();
      app.use(cors({ allowMethods: ["GET", "POST"] }));
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      });
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
    });
  });

  describe("no Origin header", () => {
    test("skips CORS headers when no Origin present", async () => {
      const app = new App();
      app.use(cors());
      app.get("/", (ctx) => ctx.text("ok"));

      const res = await req(app, "/");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("scoped cors", () => {
    test("works as scoped middleware on /api paths", async () => {
      const app = new App();
      app.use("/api", cors({ origin: "http://example.com" }));
      app.get("/api/data", (ctx) => ctx.json({ ok: true }));
      app.get("/other", (ctx) => ctx.text("no cors"));

      const apiRes = await req(app, "/api/data", {
        headers: { Origin: "http://example.com" },
      });
      expect(apiRes.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://example.com",
      );

      const otherRes = await req(app, "/other", {
        headers: { Origin: "http://example.com" },
      });
      expect(otherRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
