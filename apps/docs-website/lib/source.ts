import { type LoaderPlugin, llms, loader } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";
import { isValidElement, type ReactNode } from "react";
import { z } from "zod";
import { SITE_ORIGIN } from "@/config/site";
import { iconByName } from "./icons";
import { remarkAccordionSearch } from "./remark-accordion-search";
import { remarkStatusSearch } from "./remark-status-search";

/** The search results show text, so each MDX element, such as a callout, gives only its content. */
const structureOptions = { filterElement: () => false };

const docs = defineDocs({
  dir: "content",
  docs: {
    // The metadata, the search results, the link previews, and llms.txt show the description.
    schema: pageSchema.extend({ description: z.string().min(1) }),
    // The default plugins, the lane titles of the lane pills in the search text, and an accordion
    // with an `id` as its own search result.
    mdxOptions: applyMdxPreset({
      remarkPlugins: [remarkStatusSearch, [remarkAccordionSearch, structureOptions]],
      remarkStructureOptions: structureOptions,
    }),
    // The Markdown of each page for llms-full.txt.
    postprocess: { includeProcessedMarkdown: true },
  },
});

/**
 * Turns the `icon` name of a page or folder into its icon. A folder takes the icon of its index
 * page when its `meta.json` has none, and that icon is already an element.
 */
function resolveIcon<Node extends { icon?: ReactNode }>(node: Node): Node {
  if (node.icon === undefined || isValidElement(node.icon)) return node;
  node.icon = iconByName(String(node.icon));
  return node;
}

const iconsPlugin: LoaderPlugin = {
  name: "openducktor:icons",
  transformPageTree: { file: resolveIcon, folder: resolveIcon, separator: resolveIcon },
};

/** All published pages. The Overview is at `/`. A folder of `content/`, such as `coding-sessions`, holds the subpages of its `index` page. */
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  // The `icon` of a page names a brand logo or a Lucide icon, which the navigation shows beside the page.
  plugins: [iconsPlugin],
});

type Page = (typeof source)["$inferPage"];

/** The Open Graph image of a page: `/og/image.png` for the Overview, `/og/<slugs>/image.png` for the others. */
export function pageImage(page: Page) {
  const segments = [...page.slugs, "image.png"];
  return { segments, url: `/og/${segments.join("/")}` };
}

/** The pages for language models: the list in `/llms.txt`, and the full text in `/llms-full.txt`. */
export const docsLlms = llms(source, {
  renderPage: async (page) =>
    `# ${page.data.title} (${new URL(page.url, SITE_ORIGIN).href})\n\n${await page.data.getText("processed")}`,
});
