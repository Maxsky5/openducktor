import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const ASSET_URI_PATTERN =
  /^odt-asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const assetIds = new Set<string>();
  visit(tree, "image", (node) => {
    const match = ASSET_URI_PATTERN.exec(node.url);
    if (match?.[1]) {
      assetIds.add(match[1]);
    }
  });
  return assetIds;
};
