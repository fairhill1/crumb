import type { Middleware } from "./types";

export type CompressOptions = {
  threshold?: number;
  encodings?: ("gzip" | "deflate")[];
};

type Encoding = "gzip" | "deflate";

function parseAcceptEncoding(header: string, allowed: Encoding[]): Encoding | null {
  const entries: { encoding: string; q: number }[] = [];

  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const [encoding, ...params] = trimmed.split(";");
    let q = 1;
    for (const p of params) {
      const match = p.trim().match(/^q=(\d+\.?\d*)$/);
      if (match?.[1]) q = parseFloat(match[1]);
    }
    if (encoding) entries.push({ encoding: encoding.trim().toLowerCase(), q });
  }

  entries.sort((a, b) => b.q - a.q);

  for (const { encoding, q } of entries) {
    if (q === 0) continue;
    if (allowed.includes(encoding as Encoding)) return encoding as Encoding;
  }

  return null;
}

export function compress(options: CompressOptions = {}): Middleware {
  const threshold = options.threshold ?? 1024;
  const allowed = options.encodings ?? ["gzip", "deflate"];

  return async (ctx, next) => {
    const res = await next();

    // Skip if no body
    if (res.status === 204 || res.status === 304 || !res.body) return res;

    // Skip if already encoded
    if (res.headers.get("Content-Encoding")) return res;

    // Skip streaming responses (no Content-Length and body is a stream)
    const contentLength = res.headers.get("Content-Length");
    if (!contentLength && res.body instanceof ReadableStream) return res;

    // Pick encoding
    const accept = ctx.headers.get("Accept-Encoding");
    if (!accept) return res;

    const encoding = parseAcceptEncoding(accept, allowed);
    if (!encoding) return res;

    // Read body
    const buf = await res.arrayBuffer();
    if (buf.byteLength < threshold) {
      return new Response(buf, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    // Compress
    const data = new Uint8Array(buf);
    const compressed = encoding === "gzip" ? Bun.gzipSync(data) : Bun.deflateSync(data);

    const headers = new Headers(res.headers);
    headers.set("Content-Encoding", encoding);
    headers.set("Content-Length", String(compressed.byteLength));
    headers.append("Vary", "Accept-Encoding");

    return new Response(compressed, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
