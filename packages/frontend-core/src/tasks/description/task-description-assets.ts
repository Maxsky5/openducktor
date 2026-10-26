import { parseTaskAssetUri } from "@openducktor/contracts";

/**
 * A node of a parsed Markdown (mdast) tree. Each platform parses the description with its own
 * Markdown parser and passes the tree here.
 */
export type TaskDescriptionMarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  children?: readonly TaskDescriptionMarkdownNode[];
};

const visitNodes = (
  node: TaskDescriptionMarkdownNode,
  type: string,
  visit: (node: TaskDescriptionMarkdownNode) => void,
): void => {
  if (node.type === type) visit(node);
  for (const child of node.children ?? []) visitNodes(child, type, visit);
};

/**
 * The task asset IDs that the images of a description use, in document order: inline images
 * first, then image references. A reference uses the first definition of its identifier. Links
 * and code do not count.
 */
export const collectTaskDescriptionAssetIdsFromTree = (
  root: TaskDescriptionMarkdownNode,
): Set<string> => {
  const assetIds = new Set<string>();
  const definitions = new Map<string, string>();

  const collectUrl = (url: string | undefined): void => {
    const assetId = url === undefined ? null : parseTaskAssetUri(url);
    if (assetId) {
      assetIds.add(assetId);
    }
  };

  visitNodes(root, "definition", (node) => {
    if (
      node.identifier !== undefined &&
      node.url !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
  });
  visitNodes(root, "image", (node) => {
    collectUrl(node.url);
  });
  visitNodes(root, "imageReference", (node) => {
    if (node.identifier !== undefined) collectUrl(definitions.get(node.identifier));
  });
  return assetIds;
};

/** The staged assets that a save sends: only the ones that the description still references. */
export const selectSubmittedTaskDescriptionAssets = (
  referencedAssetIds: ReadonlySet<string>,
  stagedAssetIds: readonly string[],
): string[] => stagedAssetIds.filter((assetId) => referencedAssetIds.has(assetId));
