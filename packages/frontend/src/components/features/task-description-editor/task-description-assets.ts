import {
  collectTaskDescriptionAssetIdsFromTree,
  removeTaskDescriptionImagesFromTree,
} from "@openducktor/frontend-core/tasks/description/task-description-assets";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// One frozen processor serves every parse, so a parse does not build the GFM extensions again.
const descriptionProcessor = unified().use(remarkParse).use(remarkGfm).freeze();
const parseDescription = (markdown: string) => descriptionProcessor.parse(markdown);

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> =>
  collectTaskDescriptionAssetIdsFromTree(parseDescription(markdown));

/** Removes the images of `assetIds` that `collectTaskDescriptionAssetIds` finds. */
export const removeTaskDescriptionAssetImages = (
  markdown: string,
  assetIds: ReadonlySet<string>,
): string => removeTaskDescriptionImagesFromTree(markdown, parseDescription(markdown), assetIds);
