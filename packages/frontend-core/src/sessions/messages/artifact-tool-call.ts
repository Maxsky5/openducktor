import { mcpArtifactSaveResultSchema, type McpTaskArtifact } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase, hasNonEmptyText } from "./tool-lifecycle";

/** What an `odt_set_task_artifact` call saves: a workflow document, a QA verdict, or a free file. */
export type ArtifactToolHeading =
  | "spec"
  | "plan"
  | "qa_approved"
  | "qa_rejected"
  | "qa_report"
  | "free";

export type ArtifactToolCall = {
  heading: ArtifactToolHeading;
  title: string;
  /** The saved artifact, after the call completes with a valid result. */
  saved: McpTaskArtifact | null;
};

const HEADING_TITLES = {
  spec: "Set Spec",
  plan: "Set Plan",
  qa_approved: "Approve QA",
  qa_rejected: "Reject QA",
  qa_report: "Set QA Report",
} as const satisfies Record<Exclude<ArtifactToolHeading, "free">, string>;

/** Reads an `odt_set_task_artifact` call from its result, or from its input until it completes. */
export const readArtifactToolCall = (meta: ToolMeta): ArtifactToolCall => {
  const saved = getToolLifecyclePhase(meta) === "completed" ? readSavedArtifact(meta.output) : null;
  const code = saved?.code ?? readInputText(meta, "code");
  const verdict =
    saved?.classification === "workflow" ? saved.verdict : readInputText(meta, "verdict");
  const heading = artifactHeading(code, verdict);
  if (heading !== "free") return { heading, title: HEADING_TITLES[heading], saved };
  const name = saved?.name ?? readInputText(meta, "name") ?? code;
  return { heading, title: name ? `Set Artifact · ${name}` : "Set Artifact", saved };
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

const artifactHeading = (
  code: string | null,
  verdict: string | null | undefined,
): ArtifactToolHeading => {
  if (code === "spec") return "spec";
  if (code === "plan") return "plan";
  if (code !== "qaReport") return "free";
  if (verdict === "approved") return "qa_approved";
  if (verdict === "rejected") return "qa_rejected";
  return "qa_report";
};
