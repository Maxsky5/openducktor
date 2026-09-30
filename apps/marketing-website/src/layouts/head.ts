import type { BuildTarget } from "../../config/build";

/** What a page says about itself. Only a page that search engines can list is indexable. */
export type PageHead = { title: string; description: string; indexable: boolean };

/** The head metadata of a page for one build target. */
export type HeadTags = {
  title: string;
  description: string;
  /** Present when search engines must not list the page. */
  robots: "noindex, nofollow" | undefined;
  canonical: string | undefined;
  image: string | undefined;
};

/**
 * Only production pages can be indexed. A build without a site origin has no absolute URLs.
 * A preview build with the production origin names the production page as its canonical page.
 */
export function headTags(
  page: PageHead,
  path: string,
  target: BuildTarget,
  site: URL | undefined,
): HeadTags {
  return {
    title: page.title,
    description: page.description,
    robots: page.indexable && target === "production" ? undefined : "noindex, nofollow",
    canonical: page.indexable && site ? new URL(path, site).href : undefined,
    image: site ? new URL("/open-graph.png", site).href : undefined,
  };
}
