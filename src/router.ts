import type { Handler } from "./types";
import { extractPathname } from "./url";

class Node {
  segment: string;
  children: Map<string, Node> = new Map();
  paramChild: Node | null = null;
  wildcardChild: Node | null = null;
  paramName: string | null = null;
  handlers: Map<string, Handler> = new Map();
  paths: Map<string, string> = new Map();

  constructor(segment: string = "") {
    this.segment = segment;
  }
}

export class Router {
  private root = new Node();
  private names = new Map<string, string>();

  setName(name: string, path: string): void {
    if (this.names.has(name)) {
      throw new Error(`Route name "${name}" is already defined`);
    }
    this.names.set(name, path);
  }

  url(name: string, params?: Record<string, string>): string {
    const pattern = this.names.get(name);
    if (pattern === undefined) {
      throw new Error(`Unknown route name "${name}"`);
    }
    const segments = pattern.split("/");
    const result: string[] = [];
    for (const seg of segments) {
      if (seg === "") continue;
      if (seg === "*") {
        const value = params?.["*"];
        if (value === undefined) {
          throw new Error(`Missing wildcard param "*" for route "${name}"`);
        }
        result.push(value);
      } else if (seg.startsWith(":")) {
        const key = seg.slice(1);
        const value = params?.[key];
        if (value === undefined) {
          throw new Error(`Missing param "${key}" for route "${name}"`);
        }
        result.push(value);
      } else {
        result.push(seg);
      }
    }
    return "/" + result.join("/");
  }

  add(method: string, path: string, handler: Handler): void {
    const segments = splitPath(path);
    let node = this.root;

    for (const seg of segments) {
      if (seg.startsWith(":")) {
        if (!node.paramChild) {
          node.paramChild = new Node(seg);
          node.paramChild.paramName = seg.slice(1);
        }
        node = node.paramChild;
      } else if (seg === "*") {
        if (!node.wildcardChild) {
          node.wildcardChild = new Node(seg);
        }
        node = node.wildcardChild;
        break; // wildcard consumes the rest
      } else {
        let child = node.children.get(seg);
        if (!child) {
          child = new Node(seg);
          node.children.set(seg, child);
        }
        node = child;
      }
    }

    if (node.handlers.has(method.toUpperCase())) {
      console.warn(`Warning: ${method.toUpperCase()} ${path} overwrites an existing route`);
    }
    node.handlers.set(method.toUpperCase(), handler);
    node.paths.set(method.toUpperCase(), path);
  }

  match(
    method: string,
    url: string,
  ): { handler: Handler; params: Record<string, string>; routePath: string } | null {
    const pathname = extractPathname(url);
    const segments = splitPath(pathname);
    const params: Record<string, string> = {};

    const result = this.matchNode(this.root, segments, 0, method.toUpperCase(), params);
    if (!result) return null;
    return { handler: result.handler, params, routePath: result.routePath };
  }

  private matchNode(
    node: Node,
    segments: string[],
    index: number,
    method: string,
    params: Record<string, string>,
  ): { handler: Handler; routePath: string } | null {
    // Reached end of segments — check for handler
    if (index === segments.length) {
      const handler = node.handlers.get(method);
      if (!handler) return null;
      return { handler, routePath: node.paths.get(method)! };
    }

    const seg = segments[index]!;

    // 1. Try static child (exact match — fastest)
    const staticChild = node.children.get(seg);
    if (staticChild) {
      const result = this.matchNode(staticChild, segments, index + 1, method, params);
      if (result) return result;
    }

    // 2. Try param child
    if (node.paramChild) {
      const prevValue = params[node.paramChild.paramName!];
      params[node.paramChild.paramName!] = seg;
      const result = this.matchNode(node.paramChild, segments, index + 1, method, params);
      if (result) return result;
      // Backtrack
      if (prevValue === undefined) {
        delete params[node.paramChild.paramName!];
      } else {
        params[node.paramChild.paramName!] = prevValue;
      }
    }

    // 3. Try wildcard child (matches rest of path)
    if (node.wildcardChild) {
      const handler = node.wildcardChild.handlers.get(method);
      if (handler) {
        params["*"] = segments.slice(index).join("/");
        return { handler, routePath: node.wildcardChild.paths.get(method)! };
      }
    }

    return null;
  }
  routes(): { method: string; path: string }[] {
    const result: { method: string; path: string }[] = [];
    this.collectRoutes(this.root, "", result);
    return result;
  }

  entries(): { method: string; path: string; handler: Handler }[] {
    const result: { method: string; path: string; handler: Handler }[] = [];
    this.collectEntries(this.root, "", result);
    return result;
  }

  private collectEntries(
    node: Node,
    prefix: string,
    result: { method: string; path: string; handler: Handler }[],
  ): void {
    for (const [method, handler] of node.handlers) {
      result.push({ method, path: prefix || "/", handler });
    }
    for (const [seg, child] of node.children) {
      this.collectEntries(child, prefix + "/" + seg, result);
    }
    if (node.paramChild) {
      this.collectEntries(node.paramChild, prefix + "/:" + node.paramChild.paramName, result);
    }
    if (node.wildcardChild) {
      for (const [method, handler] of node.wildcardChild.handlers) {
        result.push({ method, path: prefix + "/*", handler });
      }
    }
  }

  private collectRoutes(
    node: Node,
    prefix: string,
    result: { method: string; path: string }[],
  ): void {
    for (const method of node.handlers.keys()) {
      result.push({ method, path: prefix || "/" });
    }

    for (const [seg, child] of node.children) {
      this.collectRoutes(child, prefix + "/" + seg, result);
    }

    if (node.paramChild) {
      this.collectRoutes(node.paramChild, prefix + "/:" + node.paramChild.paramName, result);
    }

    if (node.wildcardChild) {
      for (const method of node.wildcardChild.handlers.keys()) {
        result.push({ method, path: prefix + "/*" });
      }
    }
  }
}

function splitPath(path: string): string[] {
  const segments: string[] = [];
  for (const seg of path.split("/")) {
    if (seg !== "") segments.push(seg);
  }
  return segments;
}
