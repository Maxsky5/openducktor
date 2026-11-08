import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as PageTree from "fumadocs-core/page-tree";
import { loader } from "fumadocs-core/source";
import { withSlash } from "./slash";

/** A published page: its URL with the trailing slash of the export, and its MDX file, such as `content/mobile/index.mdx`. */
export type PublishedPage = { url: string; file: string };

const app = fileURLToPath(new URL("../", import.meta.url));

/** The navigation entries of a `meta.json` that are no page or folder: separators, links, and rest marks. */
const NOT_A_FILE = /^(---.*---|\[.*\]\(.*\)|!.*|\.\.\..*|z\.\.\.a)$/;

/**
 * The published pages, in navigation order, nested folders included. The Fumadocs loader reads the
 * same files and `meta.json` files as `lib/source.ts`, without the MDX compiler, so the build
 * scripts and the browser tests can use it. A `meta.json` entry that names no file stops it, because
 * Fumadocs skips that entry without an error.
 */
export function publishedPages(content: string = join(app, "content")): PublishedPage[] {
  const paths = readdirSync(content, { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => path.endsWith(".mdx") || path.endsWith("meta.json"));
  const files = paths.map((path) =>
    path.endsWith(".mdx")
      ? { type: "page" as const, path, data: {} }
      : {
          type: "meta" as const,
          path,
          data: JSON.parse(readFileSync(join(content, path), "utf8")),
        },
  );
  for (const meta of files) {
    if (meta.type !== "meta") continue;
    const folder = posix.dirname(meta.path);
    for (const entry of meta.data.pages ?? []) {
      if (NOT_A_FILE.test(entry)) continue;
      const target = join(content, folder, entry);
      if (!existsSync(`${target}.mdx`) && !existsSync(target)) {
        throw new Error(
          `content/${meta.path} lists "${entry}", but content/${posix.join(folder, entry)}.mdx and its folder do not exist. Fix the entry or add the page.`,
        );
      }
    }
  }
  const pages = loader({ baseUrl: "/", source: { files } });
  const published: PublishedPage[] = [];
  const visit = (nodes: PageTree.Node[]): void => {
    for (const node of nodes) {
      if (node.type === "separator") continue;
      if (node.type === "folder") {
        if (node.index) visit([node.index]);
        visit(node.children);
        continue;
      }
      const page = pages.getNodePage(node);
      if (!page) throw new Error(`The navigation has ${node.url}, but no page file.`);
      published.push({
        url: withSlash(node.url),
        file: `content/${page.path}`,
      });
    }
  };
  visit(pages.getPageTree().children);
  return published;
}
