// The build outputs that the static websites share: the build target, the Cloudflare `_headers`
// file, and `robots.txt`. The documentation and the marketing website import this module, so both
// send the same security headers.

export type BuildTarget = "local" | "preview" | "production";

/** Reads a build target, such as `DOCS_BUILD_TARGET`. Only a production build can be indexed. */
export function readBuildTarget(variable: string, value: string | undefined): BuildTarget {
  const target = value ?? "local";
  if (target !== "local" && target !== "preview" && target !== "production") {
    throw new Error(`Set ${variable} to local, preview, or production.`);
  }
  return target;
}

/**
 * The Cache-Control of the files that have a hash of their content in their name. A changed file
 * gets a new name at the next deployment, so a browser can keep each file for a year. The pages
 * and the other files keep the Cloudflare default, which checks them again at each visit, so one
 * publication never mixes old pages with new assets.
 */
export const ASSET_CACHE = "public, max-age=31556952, immutable";

/**
 * The Content-Security-Policy of the pages. The pages load each file from their own origin only,
 * and no other site can show them in a frame. The inline scripts and styles of the frameworks need
 * `'unsafe-inline'`: a static export cannot give a nonce, and the inline scripts change on each
 * page. The style sheets use `data:` SVG images.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The `_headers` file of Cloudflare Static Assets. The pages use `CONTENT_SECURITY_POLICY`, and
 * browsers use only HTTPS for the site. Only production pages can be indexed. `hashedAssets`
 * holds the path patterns of the files with a content hash in their name, such as `/_astro/*`.
 * Cloudflare joins the values of two matching rules, so give each file one pattern only.
 */
export function headersFile(target: BuildTarget, hashedAssets: readonly string[]): string {
  const pages = [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`,
    "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
    ...(target === "production" ? [] : ["  X-Robots-Tag: noindex, nofollow"]),
  ];
  const assets = hashedAssets.flatMap((pattern) => [pattern, `  Cache-Control: ${ASSET_CACHE}`]);
  return `${[...pages, ...assets].join("\n")}\n`;
}

/** `robots.txt`: with a sitemap address, it lets search engines index the site. Without, it blocks them. */
export function robotsFile(sitemap: string | null): string {
  if (sitemap === null) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`;
}
