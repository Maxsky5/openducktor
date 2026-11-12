import {
  type BuildTarget,
  headersFile as staticHeadersFile,
  readBuildTarget as readTarget,
  robotsFile as staticRobotsFile,
} from "@openducktor/build-tools/static-site";

/** The public origin of the documentation. Production metadata, the sitemap, and robots use it. */
export const SITE_ORIGIN = "https://doc.openducktor.dev";
export const SITE_NAME = "OpenDucktor documentation";
export const PRODUCT_URL = "https://openducktor.dev";
export const GITHUB_URL = "https://github.com/Maxsky5/openducktor";

/**
 * The Open Graph fields of every page. Next.js replaces the whole `openGraph` object of the layout
 * with the object of a page, so each page spreads this base into its own object.
 */
export const OPEN_GRAPH = { siteName: SITE_NAME, type: "website", locale: "en_US" } as const;

/** Reads `DOCS_BUILD_TARGET`. Only a production build can be indexed. */
export function readBuildTarget(
  value: string | undefined = process.env.DOCS_BUILD_TARGET,
): BuildTarget {
  return readTarget("DOCS_BUILD_TARGET", value);
}

/**
 * The folder of the bundled scene stylesheets in `public/`. `scripts/prepare-assets.ts` writes them
 * with a hash of their content in their name, as Next.js does in `_next/static/`.
 */
export const SCENE_STYLES_DIR = "scene-styles";

/** The `_headers` file of Cloudflare Static Assets for the export. */
export function headersFile(target: BuildTarget): string {
  return staticHeadersFile(target, ["/_next/static/*", `/${SCENE_STYLES_DIR}/*`]);
}

export function robotsFile(target: BuildTarget): string {
  return staticRobotsFile(target === "production" ? `${SITE_ORIGIN}/sitemap.xml` : null);
}
