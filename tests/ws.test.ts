import { describe, test, expect, afterEach } from "bun:test";
import { App } from "../src/app";

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  if (server) {
    server.stop(true);
    server = null;
  }
});

function wsUrl(server: ReturnType<typeof Bun.serve>, path: string): string {
  return `ws://localhost:${server.port}${path}`;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => resolve(String(e.data)), { once: true });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason }), { once: true });
  });
}

describe("WebSocket", () => {
  test("basic echo", async () => {
    const app = new App();
    app.ws("/echo", {
      message(ws, msg) {
        ws.send(String(msg));
      },
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/echo"));
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    ws.send("hello");
    expect(await msgPromise).toBe("hello");
    ws.close();
  });

  test("route params available on ws.data.params", async () => {
    const app = new App();
    app.ws("/room/:id", {
      message(ws, msg) {
        ws.send(`room=${ws.data.params.id}:${msg}`);
      },
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/room/42"));
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    ws.send("hi");
    expect(await msgPromise).toBe("room=42:hi");
    ws.close();
  });

  test("upgrade hook provides custom state", async () => {
    const app = new App();
    app.ws<{ name: string }>("/greet", {
      upgrade(_ctx) {
        return { name: "alice" };
      },
      message(ws, msg) {
        ws.send(`${ws.data.state.name}:${msg}`);
      },
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/greet"));
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    ws.send("hey");
    expect(await msgPromise).toBe("alice:hey");
    ws.close();
  });

  test("upgrade hook returns Response to reject", async () => {
    const app = new App();
    app.ws("/auth", {
      upgrade(ctx) {
        return ctx.json({ error: "Unauthorized" }, 401);
      },
      message() {},
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/auth"));
    const { code } = await waitForClose(ws);
    // Upgrade rejected — Bun closes with 1002
    expect([1002, 1006]).toContain(code);
  });

  test("middleware runs before upgrade", async () => {
    const app = new App();
    app.use(async (ctx, next) => {
      if (!ctx.headers.get("x-token")) {
        return ctx.json({ error: "Forbidden" }, 403);
      }
      return next();
    });
    app.ws("/protected", {
      message(ws, msg) {
        ws.send(String(msg));
      },
    });
    server = app.listen(0);

    // Without token — should reject
    const ws1 = new WebSocket(wsUrl(server, "/protected"));
    const { code } = await waitForClose(ws1);
    expect([1002, 1006]).toContain(code);

    // With token — should connect
    const ws2 = new WebSocket(wsUrl(server, "/protected"), {
      headers: { "x-token": "valid" },
    });
    await waitForOpen(ws2);
    const msgPromise = waitForMessage(ws2);
    ws2.send("ok");
    expect(await msgPromise).toBe("ok");
    ws2.close();
  });

  test("groups with WS routes", async () => {
    const app = new App();
    const api = app.group("/api");
    api.ws("/stream", {
      message(ws, msg) {
        ws.send(`stream:${msg}`);
      },
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/api/stream"));
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    ws.send("data");
    expect(await msgPromise).toBe("stream:data");
    ws.close();
  });

  test("non-WS GET to WS-only route returns 404", async () => {
    const app = new App();
    app.ws("/ws-only", {
      message(ws, msg) {
        ws.send(String(msg));
      },
    });
    server = app.listen(0);

    const res = await fetch(`http://localhost:${server.port}/ws-only`);
    expect(res.status).toBe(404);
  });

  test("mixed HTTP + WS on same path", async () => {
    const app = new App();
    app.get("/dual", (ctx) => ctx.text("http"));
    app.ws("/dual", {
      message(ws, msg) {
        ws.send(`ws:${msg}`);
      },
    });
    server = app.listen(0);

    // HTTP works
    const res = await fetch(`http://localhost:${server.port}/dual`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("http");

    // WS works
    const ws = new WebSocket(wsUrl(server, "/dual"));
    await waitForOpen(ws);
    const msgPromise = waitForMessage(ws);
    ws.send("hello");
    expect(await msgPromise).toBe("ws:hello");
    ws.close();
  });

  test("open and close hooks fire", async () => {
    const events: string[] = [];
    const app = new App();
    app.ws("/lifecycle", {
      open() {
        events.push("open");
      },
      message(ws, msg) {
        ws.send(String(msg));
      },
      close() {
        events.push("close");
      },
    });
    server = app.listen(0);

    const ws = new WebSocket(wsUrl(server, "/lifecycle"));
    await waitForOpen(ws);
    expect(events).toContain("open");

    ws.close();
    // Wait a tick for close to fire
    await Bun.sleep(50);
    expect(events).toContain("close");
  });

  test("server property is set after listen", () => {
    const app = new App();
    app.ws("/test", { message() {} });
    expect(app.server).toBeNull();
    server = app.listen(0);
    expect(app.server).toBe(server);
  });
});
