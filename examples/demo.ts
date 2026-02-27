import { App, cors, compress, v } from "../src";
import type { Middleware } from "../src";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Vars = { requestId: string };

type Todo = { id: number; title: string; done: boolean; createdAt: string };

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
let nextId = 1;
const todos: Todo[] = [];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new App<Vars>();

app.use(cors());
app.use(compress({ threshold: 512 }));

// Logger
app.use(async (ctx, next) => {
  const start = performance.now();
  ctx.set("requestId", crypto.randomUUID());
  const res = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`${ctx.method} ${ctx.path} → ${res.status} (${ms}ms)`);
  return res;
});

// ---------------------------------------------------------------------------
// HTML frontend (single page, no build step)
// ---------------------------------------------------------------------------
app.get("/", (ctx) => {
  return ctx.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Framework Demo</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; }
  .container { max-width: 640px; margin: 0 auto; padding: 2rem 1rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .25rem; }
  .sub { color: #888; font-size: .85rem; margin-bottom: 2rem; }
  .card { background: #161616; border: 1px solid #262626; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
  .card h2 { font-size: 1rem; margin-bottom: .75rem; color: #f5f5f5; }
  form { display: flex; gap: .5rem; margin-bottom: 1rem; }
  input[type="text"] { flex: 1; padding: .5rem .75rem; border-radius: 6px; border: 1px solid #333; background: #0a0a0a; color: #e5e5e5; font-size: .9rem; outline: none; }
  input[type="text"]:focus { border-color: #555; }
  button { padding: .5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-size: .85rem; font-weight: 500; transition: background .15s; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-sm { padding: .25rem .5rem; font-size: .75rem; border-radius: 4px; }
  .btn-danger { background: #333; color: #f87171; }
  .btn-danger:hover { background: #7f1d1d; color: #fff; }
  .btn-toggle { background: #333; color: #a3a3a3; }
  .btn-toggle:hover { background: #404040; }
  .todo-list { list-style: none; }
  .todo-item { display: flex; align-items: center; gap: .75rem; padding: .5rem 0; border-bottom: 1px solid #1e1e1e; }
  .todo-item:last-child { border-bottom: none; }
  .todo-title { flex: 1; }
  .todo-done .todo-title { text-decoration: line-through; color: #555; }
  .empty { color: #555; font-size: .85rem; padding: .5rem 0; }
  #sse-log { font-family: monospace; font-size: .8rem; max-height: 200px; overflow-y: auto; white-space: pre-wrap; color: #86efac; background: #0a0a0a; border-radius: 4px; padding: .5rem; border: 1px solid #1e1e1e; }
  .badge { font-size: .7rem; padding: .1rem .4rem; border-radius: 3px; background: #1e3a5f; color: #93c5fd; }
  .routes-table { width: 100%; font-size: .8rem; border-collapse: collapse; }
  .routes-table th, .routes-table td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #1e1e1e; }
  .routes-table th { color: #888; font-weight: 500; }
  .method { font-weight: 600; font-family: monospace; }
  .method-get { color: #86efac; }
  .method-post { color: #93c5fd; }
  .method-put { color: #fde047; }
  .method-patch { color: #fde047; }
  .method-delete { color: #f87171; }
</style>
</head>
<body>
<div class="container">
  <h1>Framework Demo</h1>
  <p class="sub">A minimal, Bun-native web framework. Zero dependencies.</p>

  <!-- Todo CRUD -->
  <div class="card">
    <h2>Todos <span class="badge">CRUD</span></h2>
    <form id="todo-form">
      <input type="text" id="todo-input" placeholder="What needs to be done?" autocomplete="off" />
      <button type="submit" class="btn-primary">Add</button>
    </form>
    <ul class="todo-list" id="todo-list"><li class="empty">No todos yet.</li></ul>
  </div>

  <!-- SSE -->
  <div class="card">
    <h2>Server-Sent Events <span class="badge">SSE</span></h2>
    <button id="sse-btn" class="btn-primary btn-sm">Connect</button>
    <div id="sse-log" style="margin-top:.75rem">Click connect to start receiving events...</div>
  </div>

  <!-- Streaming -->
  <div class="card">
    <h2>Streaming <span class="badge">Stream</span></h2>
    <button id="stream-btn" class="btn-primary btn-sm">Fetch Stream</button>
    <pre id="stream-log" style="margin-top:.75rem; font-size:.8rem; color:#93c5fd; min-height:1.5rem;"></pre>
  </div>

  <!-- Routes -->
  <div class="card">
    <h2>Registered Routes <span class="badge">Introspection</span></h2>
    <table class="routes-table" id="routes-table">
      <thead><tr><th>Method</th><th>Path</th></tr></thead>
      <tbody id="routes-body"><tr><td colspan="2" class="empty">Loading...</td></tr></tbody>
    </table>
  </div>
</div>

<script>
const API = "";

// --- Todos ---
const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");

async function loadTodos() {
  const res = await fetch(API + "/api/todos");
  const todos = await res.json();
  renderTodos(todos);
}

function renderTodos(todos) {
  if (!todos.length) { list.innerHTML = '<li class="empty">No todos yet.</li>'; return; }
  list.innerHTML = todos.map(t =>
    '<li class="todo-item' + (t.done ? ' todo-done' : '') + '">' +
      '<button class="btn-sm btn-toggle" onclick="toggleTodo(' + t.id + ',' + !t.done + ')">' + (t.done ? "undo" : "done") + '</button>' +
      '<span class="todo-title">' + esc(t.title) + '</span>' +
      '<button class="btn-sm btn-danger" onclick="deleteTodo(' + t.id + ')">x</button>' +
    '</li>'
  ).join("");
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  await fetch(API + "/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  input.value = "";
  loadTodos();
});

window.toggleTodo = async (id, done) => {
  await fetch(API + "/api/todos/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  loadTodos();
};

window.deleteTodo = async (id) => {
  await fetch(API + "/api/todos/" + id, { method: "DELETE" });
  loadTodos();
};

loadTodos();

// --- SSE ---
let evtSource = null;
const sseBtn = document.getElementById("sse-btn");
const sseLog = document.getElementById("sse-log");

sseBtn.addEventListener("click", () => {
  if (evtSource) { evtSource.close(); evtSource = null; sseBtn.textContent = "Connect"; return; }
  sseLog.textContent = "";
  evtSource = new EventSource(API + "/api/time");
  sseBtn.textContent = "Disconnect";
  evtSource.addEventListener("time", (e) => {
    sseLog.textContent += e.data + "\\n";
    sseLog.scrollTop = sseLog.scrollHeight;
  });
  evtSource.onerror = () => { evtSource.close(); evtSource = null; sseBtn.textContent = "Connect"; };
});

// --- Stream ---
const streamBtn = document.getElementById("stream-btn");
const streamLog = document.getElementById("stream-log");

streamBtn.addEventListener("click", async () => {
  streamLog.textContent = "";
  streamBtn.disabled = true;
  const res = await fetch(API + "/api/stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    streamLog.textContent += dec.decode(value);
  }
  streamBtn.disabled = false;
});

// --- Routes ---
(async () => {
  const res = await fetch(API + "/routes");
  const routes = await res.json();
  const tbody = document.getElementById("routes-body");
  tbody.innerHTML = routes.map(r =>
    '<tr><td class="method method-' + r.method.toLowerCase() + '">' + r.method + '</td><td style="font-family:monospace">' + r.path + '</td></tr>'
  ).join("");
})();
</script>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// Todo API
// ---------------------------------------------------------------------------
const api = app.group("/api");

const todoSchema = v.object({
  title: v.string().min(1).max(200),
});

const todoPatchSchema = v.object({
  title: v.string().min(1).max(200).optional(),
  done: v.boolean().optional(),
});

// List
api.get("/todos", (ctx) => {
  return ctx.json(todos);
});

// Create
api.post("/todos", async (ctx) => {
  const { title } = await ctx.body(todoSchema);
  const todo: Todo = { id: nextId++, title, done: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  return ctx.status(201).json(todo);
});

// Update
api.patch("/todos/:id", async (ctx) => {
  const { id } = ctx.validParams(v.object({ id: v.coerce.number().integer() }));
  const todo = todos.find((t) => t.id === id);
  if (!todo) return ctx.json({ error: "Not found" }, 404);
  const patch = await ctx.body(todoPatchSchema);
  if (patch.title !== undefined) todo.title = patch.title;
  if (patch.done !== undefined) todo.done = patch.done;
  return ctx.json(todo);
});

// Delete
api.delete("/todos/:id", (ctx) => {
  const { id } = ctx.validParams(v.object({ id: v.coerce.number().integer() }));
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return ctx.json({ error: "Not found" }, 404);
  todos.splice(idx, 1);
  return ctx.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// SSE — server time
// ---------------------------------------------------------------------------
api.get("/time", (ctx) => {
  return ctx.sse(async (stream) => {
    for (let i = 0; i < 30; i++) {
      await stream.sendEvent({
        id: String(i),
        event: "time",
        data: new Date().toISOString(),
      });
      await Bun.sleep(1000);
      if (stream.signal.aborted) break;
    }
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
api.get("/stream", (ctx) => {
  return ctx.stream(async (stream) => {
    const lines = [
      "Connecting to server...",
      "Authenticating...",
      "Fetching data...",
      "Processing results...",
      "Done!",
    ];
    for (const line of lines) {
      await stream.write(line + "\n");
      await Bun.sleep(400);
      if (stream.signal.aborted) break;
    }
  });
});

// ---------------------------------------------------------------------------
// Route introspection
// ---------------------------------------------------------------------------
app.get("/routes", (ctx) => ctx.json(app.routes));

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.notFound((ctx) => ctx.json({ error: "Not found", path: ctx.path }, 404));

app.onError((err, ctx) => {
  console.error(`[error] ${ctx.method} ${ctx.path}:`, (err as Error).message);
  return ctx.json({ error: "Internal server error" }, 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(3000);
console.log("Demo running at http://localhost:3000");
