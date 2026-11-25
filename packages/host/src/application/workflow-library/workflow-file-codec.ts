import {
  WORKFLOW_FILE_FORMAT_VERSION,
  workflowFileSchema,
  workflowProblemSchema,
  type AgentRoleDefinition,
  type WorkflowExport,
  type WorkflowFile,
  type WorkflowVersionDocument,
} from "@openducktor/contracts";
import { formatProblemPath, roleInputOf, versionToDocument } from "@openducktor/workflows";
import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  stringify,
  visit,
  type Alias,
  type Document,
  type Node,
} from "yaml";
import { z } from "zod";

/** The file name of an exported workflow. */
const workflowFileName = (workflowId: string): string => `${workflowId}.workflow.yaml`;

/**
 * Writes a published version as a workflow file. The file holds the custom roles that the version
 * binds; it names built-in roles only by ID. The same content always gives the same text.
 */
export const exportWorkflowFile = (
  version: WorkflowVersionDocument,
  customRoles: readonly AgentRoleDefinition[],
): WorkflowExport => {
  const document = versionToDocument(version);
  const customRolesById = new Map(customRoles.map((role) => [role.id, role]));
  const file: WorkflowFile = {
    formatVersion: WORKFLOW_FILE_FORMAT_VERSION,
    workflow: document.definition,
    prompts: document.prompts,
    roles: document.definition.roles.flatMap(({ id }) => {
      const role = customRolesById.get(id);
      return role ? [roleInputOf(role)] : [];
    }),
    layout: {
      states: Object.fromEntries(
        Object.entries(document.layout.states).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      ),
    },
  };
  // The schema parse puts every key in schema order, so equal content gives equal text.
  const text = stringify(workflowFileSchema.parse(file), {
    aliasDuplicateObjects: false,
    blockQuote: "literal",
    lineWidth: 0,
  });
  return { fileName: workflowFileName(version.definition.id), text };
};

/** Why a text is not a workflow file, with its 1-based location when the text has one. */
type WorkflowFileFailure = {
  readonly message: string;
  readonly line: number | null;
  readonly column: number | null;
};

export type WorkflowFileParseResult =
  | { readonly ok: true; readonly file: WorkflowFile }
  | ({ readonly ok: false } & WorkflowFileFailure);

type PathSegment = string | number;

const formatVersionSchema = z.number().int();

/** The deepest node of a path that the document has, and the key node of a missing key. */
const nodeAt = (document: Document, path: readonly PathSegment[], key?: string): Node | null => {
  let node: unknown = document.contents;
  for (const segment of path) {
    if (!isMap(node) && !isSeq(node)) break;
    const next: unknown = node.get(segment, true);
    if (!isNode(next)) break;
    node = next;
  }
  if (key !== undefined && isMap(node)) {
    const pair = node.items.find((item) => isScalar(item.key) && item.key.value === key);
    if (pair && isNode(pair.key)) return pair.key;
  }
  return isNode(node) ? node : null;
};

/**
 * Reads a workflow file. The format version comes first: a missing, unknown, or newer version
 * stops the read. Then the text must match the file format. Every failure names its reason and
 * its location. References to unknown elements pass, so a draft shows them as problems.
 */
/** The first alias without an anchor before it, else the first alias, for a conversion failure. */
const failingAlias = (document: Document): Alias | null => {
  let first: Alias | null = null;
  let unresolved: Alias | null = null;
  visit(document, {
    Alias: (_key, alias) => {
      first ??= alias;
      if (alias.resolve(document) !== undefined) return undefined;
      unresolved = alias;
      return visit.BREAK;
    },
  });
  return unresolved ?? first;
};

export const parseWorkflowFile = (text: string): WorkflowFileParseResult => {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  const failure = (message: string, offset: number | null): WorkflowFileParseResult => {
    const position = offset === null ? null : lineCounter.linePos(offset);
    return { ok: false, message, line: position?.line ?? null, column: position?.col ?? null };
  };
  const failureAt = (message: string, node: Node | null) =>
    failure(message, node?.range ? node.range[0] : null);

  const yamlError = document.errors[0];
  if (yamlError)
    return failure(`The text is not readable YAML. ${yamlError.message}`, yamlError.pos[0]);
  if (!isMap(document.contents))
    return failureAt(
      "The text is not a workflow file. A workflow file is a YAML mapping that starts with formatVersion.",
      document.contents,
    );

  const formatVersion: unknown = document.contents.get("formatVersion", true);
  if (formatVersion === undefined)
    return failureAt(
      "The file has no formatVersion. Export the workflow again from OpenDucktor.",
      document.contents,
    );
  const version = formatVersionSchema.safeParse(
    isScalar(formatVersion) ? formatVersion.value : undefined,
  );
  if (version.success && version.data > WORKFLOW_FILE_FORMAT_VERSION)
    return failureAt(
      `The file has format version ${version.data}, which is newer than this app supports (${WORKFLOW_FILE_FORMAT_VERSION}). Update OpenDucktor, then import the file again.`,
      isNode(formatVersion) ? formatVersion : null,
    );
  if (!version.success || version.data !== WORKFLOW_FILE_FORMAT_VERSION)
    return failureAt(
      `The file has an unknown formatVersion. Use format version ${WORKFLOW_FILE_FORMAT_VERSION}.`,
      isNode(formatVersion) ? formatVersion : null,
    );

  let data: unknown;
  try {
    data = document.toJS();
  } catch (cause) {
    // An unresolved alias or too many alias expansions fail only when the YAML turns into data.
    return failureAt(
      `The text is not readable YAML. ${cause instanceof Error ? cause.message : String(cause)}`,
      failingAlias(document) ?? document.contents,
    );
  }
  const parsed = workflowFileSchema.safeParse(data);
  if (parsed.success) return { ok: true, file: parsed.data };
  // A failed parse has at least one issue. The first one names the location.
  const [issue] = parsed.error.issues;
  if (!issue) throw new Error("The workflow file parse failed without an issue.");
  // Zod paths of JSON data hold only keys and indexes.
  const path = workflowProblemSchema.shape.path.parse(issue.path);
  const unknownKey = issue.code === "unrecognized_keys" ? issue.keys[0] : undefined;
  const fieldPath = unknownKey === undefined ? path : [...path, unknownKey];
  const where = fieldPath.length > 0 ? ` (at ${formatProblemPath(fieldPath)})` : "";
  return failureAt(
    `The file does not match the workflow file format: ${issue.message}${where}.`,
    nodeAt(document, path, unknownKey),
  );
};
