import {
  parseTaskAssetUri,
  TASK_ASSET_MAX_DESCRIPTION_ASSETS,
  TASK_ASSET_URI_PREFIX,
} from "@openducktor/contracts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { taskAssetValidationError } from "./task-asset-error";

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const assetIds = new Set<string>();

  visit(tree, "image", (node) => {
    const url = typeof node.url === "string" ? node.url : "";
    if (!url.startsWith(TASK_ASSET_URI_PREFIX)) {
      return;
    }
    const assetId = parseTaskAssetUri(url);
    if (!assetId) {
      throw taskAssetValidationError(
        `The description contains an invalid odt-asset image destination: ${url}`,
      );
    }
    assetIds.add(assetId);
  });

  if (assetIds.size > TASK_ASSET_MAX_DESCRIPTION_ASSETS) {
    throw taskAssetValidationError(
      `A task description may reference at most ${TASK_ASSET_MAX_DESCRIPTION_ASSETS} distinct task assets.`,
      Array.from(assetIds),
    );
  }

  return assetIds;
};
