import { mcpArtifactSaveResultSchema, type McpTaskArtifact } from "@openducktor/contracts";
import {
  workflowArtifact,
  workflowArtifactLabel,
  workflowArtifactShortLabel,
  workflowArtifactVerdict,
} from "@openducktor/workflows";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase, hasNonEmptyText } from "./tool-lifecycle";

/** What an `odt_set_task_artifact` call saves: a workflow document, a review, or a free file. */
export type ArtifactToolHeading =
  | "document"
  | "review_passed"
  | "review_failed"
  | "review"
  | "free";

/** The heading and title of a workflow artifact call. */
type WorkflowArtifactHeading = { heading: Exclude<ArtifactToolHeading, "free">; title: string };

export type ArtifactToolCall = {
  heading: ArtifactToolHeading;
  title: string;
  /** The artifact code, from the result or the input. */
  code: string | null;
  /** The saved artifact, after the call completes with a valid result. */
  saved: McpTaskArtifact | null;
};

/** Reads an `odt_set_task_artifact` call from its result, or from its input until it completes. */
export const readArtifactToolCall = (meta: ToolMeta): ArtifactToolCall => {
  const saved = getToolLifecyclePhase(meta) === "completed" ? readSavedArtifact(meta.output) : null;
  const code = saved?.code ?? readInputText(meta, "code");
  const verdict =
    saved?.classification === "workflow" ? saved.verdict : readInputText(meta, "verdict");
  const artifact = code ? workflowArtifact(code) : undefined;
  if (code && artifact) return { ...workflowHeading(code, artifact.kind, verdict), code, saved };
  const name = saved?.name ?? readInputText(meta, "name") ?? code;
  const title = name ? `Set Artifact · ${name}` : "Set Artifact";
  return { heading: "free", title, code, saved };
};

const readInputText = (meta: ToolMeta, field: string): string | null => {
  const value = meta.input?.[field];
  return hasNonEmptyText(value) ? value.trim() : null;
};

const readSavedArtifact = (output: string | undefined): McpTaskArtifact | null => {
  if (!output) return null;
  try {
    const result = mcpArtifactSaveResultSchema.safeParse(JSON.parse(output));
    return result.success ? result.data.artifact : null;
  } catch {
    return null;
  }
};

/** Documents read "Set <name>". A review reads "Approve" or "Reject" by its verdict. */
const workflowHeading = (
  code: string,
  kind: "document" | "review",
  verdict: string | null | undefined,
): WorkflowArtifactHeading => {
  const name = workflowArtifactShortLabel(code);
  if (kind === "document") return { heading: "document", title: `Set ${name}` };
  const declared = verdict ? workflowArtifactVerdict(code, verdict) : undefined;
  if (declared?.passes === false) return { heading: "review_failed", title: `Reject ${name}` };
  if (declared?.passes) return { heading: "review_passed", title: `Approve ${name}` };
  return { heading: "review", title: `Set ${workflowArtifactLabel(code)}` };
};
