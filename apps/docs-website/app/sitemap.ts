import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/config/site";
import { withSlash } from "@/lib/slash";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Each page is a folder, so its address ends with a slash, as in the canonical metadata.
  return source.getPages().map((page) => ({ url: `${SITE_ORIGIN}${withSlash(page.url)}` }));
}
