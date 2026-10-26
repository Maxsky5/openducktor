import { collectTaskDescriptionAssetIdsFromTree } from "@openducktor/frontend-core/tasks/description/task-description-assets";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const collectTaskDescriptionAssetIds = (markdown: string): Set<string> =>
  collectTaskDescriptionAssetIdsFromTree(unified().use(remarkParse).use(remarkGfm).parse(markdown));
