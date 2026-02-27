import { App, cors, compress, v } from "../src";
import type { Middleware } from "../src";

// ---------------------------------------------------------------------------
// App with typed variables
// ---------------------------------------------------------------------------
type Vars = { user: { id: number; role: string }; requestId: string };

const app = new App<Vars>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// CORS — allow all origins
app.use(cors());

// Compression — gzip responses > 512 bytes
app.use(compress({ threshold: 512 }));

// Logger
app.use(async (ctx, next) => {
  const start = performance.now();
  const res = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`${ctx.method} ${ctx.path} ${res.status} ${ms}ms`);
  return res;
});

// Request ID + typed variable
app.use(async (ctx, next) => {
  ctx.set("requestId", crypto.randomUUID());
  return next();
});

// ---------------------------------------------------------------------------
// Auth middleware (route-level)
// ---------------------------------------------------------------------------
const auth: Middleware<Vars> = async (ctx, next) => {
  const token = ctx.headers.get("Authorization");
  if (!token) return ctx.json({ error: "Unauthorized" }, 401);
  // Fake user lookup
  ctx.set("user", { id: 1, role: "admin" });
  return next();
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Basic JSON response
app.get("/", (ctx) => {
  return ctx.json({ hello: "world", requestId: ctx.var.requestId });
});

// Named route + params
app.get("/users/:id", (ctx) => {
  return ctx.json({ id: ctx.params.id, routePath: ctx.routePath });
}).as("user.show");

// Route-level middleware — only /me requires auth
app.get("/me", auth, (ctx) => {
  return ctx.json({ user: ctx.get("user") });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const createUserSchema = v.object({
  name: v.string().min(1).max(100),
  email: v.string().pattern(/^[^@]+@[^@]+\.[^@]+$/),
  age: v.number().min(0).max(150).optional(),
  role: v.enum(["admin", "user"] as const),
  tags: v.array(v.string()).max(10).optional(),
});

app.post("/users", async (ctx) => {
  const data = await ctx.body(createUserSchema);
  return ctx.status(201).json({ created: data });
});

// Query param validation with coercion
app.get("/search", (ctx) => {
  const { q, page, limit, active } = ctx.validQuery(
    v.object({
      q: v.string().min(1),
      page: v.coerce.number().min(1).optional(),
      limit: v.coerce.number().min(1).max(100).optional(),
      active: v.coerce.boolean().optional(),
    }),
  );
  return ctx.json({ q, page: page ?? 1, limit: limit ?? 20, active });
});

// Route param coercion
app.get("/items/:id", (ctx) => {
  const { id } = ctx.validParams(v.object({ id: v.coerce.number().integer() }));
  return ctx.json({ id, type: typeof id }); // id is number
});

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
app.get("/cookie/set", (ctx) => {
  return ctx
    .setCookie("session", "abc123", { httpOnly: true, maxAge: 3600 })
    .setCookie("theme", "dark")
    .json({ set: true });
});

app.get("/cookie/read", (ctx) => {
  return ctx.json({
    session: ctx.cookie("session"),
    theme: ctx.cookie("theme"),
    all: ctx.cookie(),
  });
});

app.get("/cookie/delete", (ctx) => {
  return ctx.deleteCookie("session").json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
app.get("/stream", (ctx) => {
  return ctx.stream(async (stream) => {
    for (let i = 0; i < 5; i++) {
      await stream.write(`chunk ${i}\n`);
      await Bun.sleep(200);
      if (stream.signal.aborted) break;
    }
  });
});

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------
app.get("/events", (ctx) => {
  return ctx.sse(async (stream) => {
    for (let i = 0; i < 10; i++) {
      await stream.sendEvent({
        id: String(i),
        event: "tick",
        data: JSON.stringify({ count: i, time: new Date().toISOString() }),
      });
      await Bun.sleep(1000);
      if (stream.signal.aborted) break;
    }
  });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
app.ws<{ username: string }>("/ws/chat/:room", {
  upgrade(ctx) {
    const username = ctx.query.get("username");
    if (!username) return ctx.json({ error: "username required" }, 400);
    return { username };
  },
  open(ws) {
    const room = ws.data.params.room!;
    ws.subscribe(room);
    ws.publish(room, `${ws.data.state.username} joined`);
  },
  message(ws, msg) {
    const room = ws.data.params.room!;
    ws.publish(room, `${ws.data.state.username}: ${msg}`);
  },
  close(ws) {
    const room = ws.data.params.room!;
    ws.publish(room, `${ws.data.state.username} left`);
    ws.unsubscribe(room);
  },
});

// ---------------------------------------------------------------------------
// Route groups
// ---------------------------------------------------------------------------
const api = app.group("/api");
api.get("/health", (ctx) => ctx.text("ok"));

const v1 = api.group("/v1");

v1.get("/posts", (ctx) => {
  return ctx.json([
    { id: 1, title: "Hello" },
    { id: 2, title: "World" },
  ]);
}).as("api.posts");

v1.get("/posts/:id", (ctx) => {
  return ctx.json({ id: ctx.params.id, title: "Hello" });
}).as("api.post");

// ---------------------------------------------------------------------------
// Named routes — URL generation
// ---------------------------------------------------------------------------
app.get("/urls", (ctx) => {
  return ctx.json({
    userShow: app.url("user.show", { id: "42" }),
    apiPosts: app.url("api.posts"),
    apiPost: app.url("api.post", { id: "7" }),
  });
});

// ---------------------------------------------------------------------------
// Route introspection
// ---------------------------------------------------------------------------
app.get("/routes", (ctx) => ctx.json(app.routes));

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
app.static("/public", "./examples/static");

// ---------------------------------------------------------------------------
// Custom error handling
// ---------------------------------------------------------------------------
app.notFound((ctx) => {
  return ctx.json({ error: "Not found", path: ctx.path }, 404);
});

app.onError((err, ctx) => {
  console.error(`[error] ${ctx.method} ${ctx.path}:`, (err as Error).message);
  return ctx.json({ error: "Internal server error" }, 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(3000);

console.log(`
  Server running at http://localhost:3000

  Try:
    curl http://localhost:3000/
    curl http://localhost:3000/users/42
    curl http://localhost:3000/search?q=bun&page=2&limit=10
    curl http://localhost:3000/items/99
    curl -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"name":"Alice","email":"alice@example.com","role":"admin"}'
    curl http://localhost:3000/me -H 'Authorization: Bearer token'
    curl http://localhost:3000/cookie/set
    curl http://localhost:3000/stream
    curl http://localhost:3000/events
    curl http://localhost:3000/urls
    curl http://localhost:3000/routes
    curl http://localhost:3000/public/index.html
`);
