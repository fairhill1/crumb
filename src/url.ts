export function extractPathname(url: string): string {
  // Fast path: if it starts with "/" it's already a pathname
  if (url.charCodeAt(0) === 47 /* '/' */) {
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q);
  }
  // Full URL — find pathname after the authority
  const protoEnd = url.indexOf("://");
  if (protoEnd === -1) return url;
  const pathStart = url.indexOf("/", protoEnd + 3);
  if (pathStart === -1) return "/";
  const q = url.indexOf("?", pathStart);
  return q === -1 ? url.slice(pathStart) : url.slice(pathStart, q);
}
