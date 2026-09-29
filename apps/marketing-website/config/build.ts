export type BuildTarget = "local" | "preview" | "production";
export type BuildConfig = { target: BuildTarget; origin: string | undefined };
type BuildEnvironment = {
  MARKETING_BUILD_TARGET?: string | undefined;
  MARKETING_SITE_ORIGIN?: string | undefined;
};

export function readBuildConfig(
  env: BuildEnvironment = {
    MARKETING_BUILD_TARGET: process.env.MARKETING_BUILD_TARGET,
    MARKETING_SITE_ORIGIN: process.env.MARKETING_SITE_ORIGIN,
  },
): BuildConfig {
  const target = env.MARKETING_BUILD_TARGET ?? "local";
  if (target !== "local" && target !== "preview" && target !== "production") {
    throw new Error("Set MARKETING_BUILD_TARGET to local, preview, or production.");
  }
  const value = env.MARKETING_SITE_ORIGIN;
  if (!value) {
    if (target === "production") {
      throw new Error(
        "Set MARKETING_SITE_ORIGIN to the real HTTPS production origin before building production.",
      );
    }
    return { target, origin: undefined };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MARKETING_SITE_ORIGIN must be a valid HTTPS origin.");
  }
  const host = url.hostname.toLowerCase();
  const reserved = [
    "localhost",
    "local",
    "test",
    "invalid",
    "example",
    "example.com",
    "example.org",
    "example.net",
    "workers.dev",
    "pages.dev",
    "vercel.app",
    "netlify.app",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.port ||
    value.trim() !== value ||
    !/^https:\/\/[^/?#\\]+\/?$/i.test(value) ||
    host.endsWith(".") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    reserved.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    throw new Error(
      "MARKETING_SITE_ORIGIN must be the real HTTPS production origin, without credentials, port, path, query, fragment, or a local/example/preview host.",
    );
  }
  return { target, origin: url.origin };
}

const disallowRobots = "User-agent: *\nDisallow: /\n";

/**
 * The Cache-Control of the files in _astro/. Astro puts a hash of its content in the name of each
 * of these files, so a changed file gets a new name at the next deployment. A browser can keep
 * each file for a year. The pages and the files at the root keep the Cloudflare default, which
 * checks each file again at each visit.
 */
export const ASSET_CACHE = "public, max-age=31556952, immutable";

/** The response headers of every page and asset. Only production pages can be indexed. */
export function headersFile(target: BuildTarget): string {
  const security =
    "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n";
  const pages =
    target === "production" ? security : `${security}  X-Robots-Tag: noindex, nofollow\n`;
  return `${pages}/_astro/*\n  Cache-Control: ${ASSET_CACHE}\n`;
}

export function staticFiles(config: BuildConfig): Map<string, string> {
  const files = new Map<string, string>();
  files.set("_headers", headersFile(config.target));
  files.set("robots.txt", disallowRobots);
  if (config.target === "production" && config.origin) {
    files.set("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${config.origin}/sitemap.xml\n`);
    files.set(
      "sitemap.xml",
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${config.origin}/</loc></url></urlset>\n`,
    );
  }
  return files;
}
