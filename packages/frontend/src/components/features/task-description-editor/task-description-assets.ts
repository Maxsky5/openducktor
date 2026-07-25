import { parseTaskAssetUri } from "@openducktor/contracts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const assetIds = new Set<string>();
  const definitions = new Map<string, string>();

  const collectUrl = (url: string): void => {
    const assetId = parseTaskAssetUri(url);
    if (assetId) {
      assetIds.add(assetId);
    }
  };

  visit(tree, "definition", (node) => {
    definitions.set(node.identifier, node.url);
  });
  visit(tree, "image", (node) => {
    collectUrl(node.url);
  });
  visit(tree, "imageReference", (node) => {
    const url = definitions.get(node.identifier);
    if (url) {
      collectUrl(url);
    }
  });
  return assetIds;
};

export const collectTaskDescriptionAssetsForSubmit = (
  markdown: string,
  stagedAssetIds: string[],
): { referencedAssetIds: Set<string>; stagedAssetIds: string[] } => {
  const referencedAssetIds = collectTaskDescriptionAssetIds(markdown);
  return {
    referencedAssetIds,
    stagedAssetIds: stagedAssetIds.filter((assetId) => referencedAssetIds.has(assetId)),
  };
};
