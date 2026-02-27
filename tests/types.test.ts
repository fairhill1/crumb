import { describe, test } from "bun:test";
import { App } from "../src";

describe("typed route params", () => {
  test("single param: ctx.params.id is string, ctx.params.nope is error", () => {
    const app = new App();
    app.get("/users/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error — 'nope' does not exist on { id: string }
      ctx.params.nope;
      return ctx.json({ id });
    });
  });

  test("multiple params: both available", () => {
    const app = new App();
    app.get("/users/:id/posts/:postId", (ctx) => {
      const id: string = ctx.params.id;
      const postId: string = ctx.params.postId;
      // @ts-expect-error — 'missing' does not exist
      ctx.params.missing;
      return ctx.json({ id, postId });
    });
  });

  test("wildcard: ctx.params['*'] is string", () => {
    const app = new App();
    app.get("/files/*", (ctx) => {
      const wildcard: string = ctx.params["*"];
      return ctx.text(wildcard);
    });
  });

  test("no params: accessing any param is an error", () => {
    const app = new App();
    app.get("/", (ctx) => {
      // @ts-expect-error — no params on '/'
      ctx.params.anything;
      return ctx.text("ok");
    });
  });

  test("non-literal string falls back to Record<string, string>", () => {
    const app = new App();
    const path: string = "/dynamic";
    app.get(path, (ctx) => {
      // Should not error — fallback to Record<string, string>
      const val: string | undefined = ctx.params.anything;
      return ctx.text(val ?? "");
    });
  });

  test("all HTTP methods infer params", () => {
    const app = new App();
    app.post("/items/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error
      ctx.params.nope;
      return ctx.json({ id });
    });
    app.put("/items/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error
      ctx.params.nope;
      return ctx.json({ id });
    });
    app.delete("/items/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error
      ctx.params.nope;
      return ctx.json({ id });
    });
    app.patch("/items/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error
      ctx.params.nope;
      return ctx.json({ id });
    });
    app.all("/items/:id", (ctx) => {
      const id: string = ctx.params.id;
      // @ts-expect-error
      ctx.params.nope;
      return ctx.json({ id });
    });
  });
});
