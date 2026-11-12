import {
  type BuildTarget,
  headersFile,
  readBuildTarget,
  robotsFile,
} from "@openducktor/build-tools/static-site";

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
  const target = readBuildTarget("MARKETING_BUILD_TARGET", env.MARKETING_BUILD_TARGET);
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

/** The files in _astro/ have a hash of their content in their name. */
const HASHED_ASSETS = ["/_astro/*"];

export function staticFiles(config: BuildConfig): Map<string, string> {
  const files = new Map<string, string>();
  files.set("_headers", headersFile(config.target, HASHED_ASSETS));
  const indexable = config.target === "production" && config.origin;
  files.set("robots.txt", robotsFile(indexable ? `${config.origin}/sitemap.xml` : null));
  if (indexable) {
    files.set(
      "sitemap.xml",
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${config.origin}/</loc></url></urlset>\n`,
    );
  }
  return files;
}
