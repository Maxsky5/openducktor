/**
 * A page path with its trailing slash, as the export publishes each page: `/mobile` becomes
 * `/mobile/`. Fumadocs, the router, and the search index can omit the slash.
 */
export function withSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}
