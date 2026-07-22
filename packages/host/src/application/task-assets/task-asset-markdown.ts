import { TASK_ASSET_MAX_DESCRIPTION_ASSETS, taskAssetIdSchema } from "@openducktor/contracts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { taskAssetValidationError } from "./task-asset-error";

const TASK_ASSET_SCHEME = "odt-asset:";

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const assetIds = new Set<string>();

  visit(tree, "image", (node) => {
    const url = typeof node.url === "string" ? node.url : "";
    if (!url.startsWith(TASK_ASSET_SCHEME)) {
      return;
    }
    const assetId = url.slice(TASK_ASSET_SCHEME.length);
    const parsed = taskAssetIdSchema.safeParse(assetId);
    if (!parsed.success) {
      throw taskAssetValidationError(
        `The description contains an invalid odt-asset image destination: ${url}`,
      );
    }
    assetIds.add(parsed.data);
  });

  if (assetIds.size > TASK_ASSET_MAX_DESCRIPTION_ASSETS) {
    throw taskAssetValidationError(
      `A task description may reference at most ${TASK_ASSET_MAX_DESCRIPTION_ASSETS} distinct task assets.`,
      Array.from(assetIds),
    );
  }

  return assetIds;
};
