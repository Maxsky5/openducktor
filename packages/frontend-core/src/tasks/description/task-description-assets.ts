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
  /** The source offsets of the node. Removing images needs them. */
  position?:
    | { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
    | undefined;
};

const visitNodes = (
  node: TaskDescriptionMarkdownNode,
  type: string,
  visit: (node: TaskDescriptionMarkdownNode) => void,
): void => {
  if (node.type === type) visit(node);
  for (const child of node.children ?? []) visitNodes(child, type, visit);
};

/** The first definition of each identifier, which a reference uses. */
const firstDefinitions = (
  root: TaskDescriptionMarkdownNode,
): Map<string, TaskDescriptionMarkdownNode> => {
  const definitions = new Map<string, TaskDescriptionMarkdownNode>();
  visitNodes(root, "definition", (node) => {
    if (node.identifier !== undefined && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
  });
  return definitions;
};

const assetIdOf = (url: string | undefined): string | null =>
  url === undefined ? null : parseTaskAssetUri(url);

type TaskAssetImage = { node: TaskDescriptionMarkdownNode; assetId: string };

/**
 * The images of task assets in document order: inline images first, then image references.
 * Links and code do not count.
 */
const taskAssetImages = (
  root: TaskDescriptionMarkdownNode,
  definitions: ReadonlyMap<string, TaskDescriptionMarkdownNode>,
): TaskAssetImage[] => {
  const images: TaskAssetImage[] = [];
  const add = (node: TaskDescriptionMarkdownNode, url: string | undefined): void => {
    const assetId = assetIdOf(url);
    if (assetId) images.push({ node, assetId });
  };
  visitNodes(root, "image", (node) => add(node, node.url));
  visitNodes(root, "imageReference", (node) =>
    add(node, node.identifier === undefined ? undefined : definitions.get(node.identifier)?.url),
  );
  return images;
};

/** The task asset IDs that the images of a description use, in document order. */
export const collectTaskDescriptionAssetIdsFromTree = (
  root: TaskDescriptionMarkdownNode,
): Set<string> =>
  new Set(taskAssetImages(root, firstDefinitions(root)).map((image) => image.assetId));

/** The staged assets that a save sends: only the ones that the description still references. */
export const selectSubmittedTaskDescriptionAssets = (
  referencedAssetIds: ReadonlySet<string>,
  stagedAssetIds: readonly string[],
): string[] => stagedAssetIds.filter((assetId) => referencedAssetIds.has(assetId));

type SourceRange = { start: number; end: number };

const sourceRange = (node: TaskDescriptionMarkdownNode): SourceRange => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error("The Markdown parser returned an image without a source position.");
  }
  return { start, end };
};

/** Widens a range to its whole line when nothing else is on that line. */
const withEmptyLine = (markdown: string, { start, end }: SourceRange): SourceRange => {
  const lineStart = markdown.lastIndexOf("\n", start - 1) + 1;
  const newline = markdown.indexOf("\n", end);
  const lineEnd = newline === -1 ? markdown.length : newline;
  const aloneOnLine =
    markdown.slice(lineStart, start).trim() === "" && markdown.slice(end, lineEnd).trim() === "";
  if (!aloneOnLine) return { start, end };
  return { start: lineStart, end: newline === -1 ? lineEnd : newline + 1 };
};

/**
 * Removes the images of `assetIds` from a description with the parsed tree of that description,
 * so it removes the same images that `collectTaskDescriptionAssetIdsFromTree` finds: inline
 * images and image references. A definition goes too when no other reference uses it. Code and
 * other text stay.
 */
export const removeTaskDescriptionImagesFromTree = (
  markdown: string,
  root: TaskDescriptionMarkdownNode,
  assetIds: ReadonlySet<string>,
): string => {
  const definitions = firstDefinitions(root);
  const removed = new Set(
    taskAssetImages(root, definitions)
      .filter((image) => assetIds.has(image.assetId))
      .map((image) => image.node),
  );
  const usedIdentifiers = new Set<string>();
  for (const type of ["imageReference", "linkReference"])
    visitNodes(root, type, (node) => {
      if (node.identifier !== undefined && !removed.has(node)) usedIdentifiers.add(node.identifier);
    });
  for (const [identifier, definition] of definitions) {
    const assetId = assetIdOf(definition.url);
    if (assetId && assetIds.has(assetId) && !usedIdentifiers.has(identifier))
      removed.add(definition);
  }

  const ranges = Array.from(removed, (node) => withEmptyLine(markdown, sourceRange(node))).sort(
    (left, right) => right.start - left.start,
  );
  let next = markdown;
  for (const { start, end } of ranges) next = next.slice(0, start) + next.slice(end);
  return next;
};
