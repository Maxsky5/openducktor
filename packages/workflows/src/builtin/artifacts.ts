import {
  BUILTIN_ARTIFACTS,
  BUILTIN_STEPS,
  type BuiltinDocumentCode,
  type BuiltinTaskEventId,
} from "./definition";
import type { BuiltinRoleId } from "./ids";

type BuiltinArtifact = (typeof BUILTIN_ARTIFACTS)[number];

const artifactsByCode = new Map<string, BuiltinArtifact>(
  BUILTIN_ARTIFACTS.map((artifact) => [artifact.id, artifact]),
);
const artifactOrder = new Map<string, number>(
  BUILTIN_ARTIFACTS.map((artifact, index) => [artifact.id, index]),
);

/** The workflow artifact of a code, or undefined for a free artifact code. */
export const workflowArtifact = (code: string): BuiltinArtifact | undefined =>
  artifactsByCode.get(code);

export const workflowArtifactLabel = (code: string): string =>
  artifactsByCode.get(code)?.label ?? code;

export const workflowArtifactShortLabel = (code: string): string => {
  const artifact = artifactsByCode.get(code);
  return artifact?.shortLabel ?? artifact?.label ?? code;
};

/** The role of the step that produces the artifact. */
export const workflowArtifactRole = (code: string): BuiltinRoleId | undefined =>
  BUILTIN_STEPS.find((step) => step.outputs.some((output) => output === code))?.roleId;

const DOCUMENT_PLACEHOLDERS = {
  spec: "# Purpose\n\nDescribe expected outcome...",
  plan: "## Milestones\n\n- ...",
} satisfies Record<BuiltinDocumentCode, string>;

/** The editor placeholder of a workflow document. */
export const workflowDocumentPlaceholder = (code: BuiltinDocumentCode): string =>
  DOCUMENT_PLACEHOLDERS[code];

/** Workflow artifacts sort in definition order. Unknown codes sort last. */
export const workflowArtifactOrder = (code: string): number =>
  artifactOrder.get(code) ?? BUILTIN_ARTIFACTS.length;

/** The label of a verdict and whether it accepts the reviewed work. */
export const workflowArtifactVerdict = (
  code: string,
  verdict: string,
): { label: string; passes: boolean } | undefined => {
  const artifact = artifactsByCode.get(code);
  if (artifact?.kind !== "review") return undefined;
  const declared = artifact.verdicts.find((candidate) => candidate.id === verdict);
  return declared ? { label: declared.label, passes: declared.passes } : undefined;
};

/** The event that a submit sends: the event of the review verdict, or the document save event. */
export const workflowArtifactSubmitEvent = (
  code: string,
  verdict: string | undefined,
): BuiltinTaskEventId | undefined => {
  const artifact = artifactsByCode.get(code);
  if (artifact?.kind === "review") {
    return artifact.verdicts.find((candidate) => candidate.id === verdict)?.eventId;
  }
  return artifact?.saveEventId;
};

/** Documents that a person may edit. Reviews change only with their verdicts. */
export const isEditableWorkflowDocument = (code: string): code is BuiltinDocumentCode =>
  artifactsByCode.get(code)?.kind === "document";
