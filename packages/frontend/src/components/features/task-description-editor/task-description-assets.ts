import { parseTaskAssetUri } from "@openducktor/contracts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const assetIds = new Set<string>();
  visit(tree, "image", (node) => {
    const assetId = parseTaskAssetUri(node.url);
    if (assetId) {
      assetIds.add(assetId);
    }
  });
  return assetIds;
};
