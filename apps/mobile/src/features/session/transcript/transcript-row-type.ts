import type { AgentChatToolCallPresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { RuntimeKind } from "@openducktor/contracts";
import { resolveInstructionsMessage } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import { SYSTEM_PROMPT_PREFIX } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";

/** Resolves how the runtime presents a tool, such as a workflow tool or a task tool. */
export type PresentToolCall = (
  toolName: string,
  displayLabel?: string,
) => AgentChatToolCallPresentation;

type MessageMeta = NonNullable<AgentChatMessage["meta"]>;
type MetaOf<Kind extends MessageMeta["kind"]> = Extract<MessageMeta, { kind: Kind }>;
type TaskToolPresentation = Extract<AgentChatToolCallPresentation, { kind: "task" }>;
type ArtifactToolPresentation = Extract<AgentChatToolCallPresentation, { kind: "artifact" }>;

/** The row of a message, with the data that its row view needs, as the desktop `MessageBody`. */
export type MessageRowKind =
  | { kind: "image"; meta: MetaOf<"image_generation"> }
  | { kind: "reasoning" }
  | { kind: "computer_use"; meta: MetaOf<"tool"> }
  | { kind: "task_tool"; meta: MetaOf<"tool">; taskTool: TaskToolPresentation["taskTool"] }
  | { kind: "workflow_tool"; meta: MetaOf<"tool">; displayName: string }
  | {
      kind: "artifact_tool";
      meta: MetaOf<"tool">;
      displayName: string;
      operation: ArtifactToolPresentation["operation"];
    }
  | { kind: "tool"; meta: MetaOf<"tool">; displayName: string }
  | { kind: "subagent"; meta: MetaOf<"subagent"> }
  | { kind: "notice"; meta: MetaOf<"session_notice"> }
  | { kind: "user" }
  | { kind: "assistant" }
  | { kind: "system" };

// FlashList reads the type of each row that it has not measured on every layout pass, so a long
// transcript asks it thousands of times. A message object never changes, so its kind builds once.
const rowKinds = new WeakMap<PresentToolCall, WeakMap<AgentChatMessage, MessageRowKind>>();

/** The row kind of a message. Show reasoning decides earlier whether reasoning rows exist. */
export const messageRowKind = (
  message: AgentChatMessage,
  presentToolCall: PresentToolCall,
): MessageRowKind => {
  let kinds = rowKinds.get(presentToolCall);
  if (!kinds) {
    kinds = new WeakMap();
    rowKinds.set(presentToolCall, kinds);
  }
  const known = kinds.get(message);
  if (known) return known;
  const kind = resolveMessageRowKind(message, presentToolCall);
  kinds.set(message, kind);
  return kind;
};

const resolveMessageRowKind = (
  message: AgentChatMessage,
  presentToolCall: PresentToolCall,
): MessageRowKind => {
  const meta = message.meta;
  switch (meta?.kind) {
    case "image_generation":
      return { kind: "image", meta };
    case "reasoning":
      return { kind: "reasoning" };
    case "tool": {
      if (meta.toolType === "computer_use") return { kind: "computer_use", meta };
      const presentation = presentToolCall(meta.tool, meta.displayLabel);
      if (presentation.kind === "task") {
        return { kind: "task_tool", meta, taskTool: presentation.taskTool };
      }
      if (presentation.kind === "artifact") {
        return {
          kind: "artifact_tool",
          meta,
          displayName: presentation.displayName,
          operation: presentation.operation,
        };
      }
      if (presentation.kind === "workflow") {
        return { kind: "workflow_tool", meta, displayName: presentation.displayName };
      }
      return { kind: "tool", meta, displayName: presentation.displayName };
    }
    case "subagent":
      return { kind: "subagent", meta };
    case "session_notice":
      return { kind: "notice", meta };
    default:
      break;
  }
  if (message.role === "user") return { kind: "user" };
  if (message.role === "assistant") return { kind: "assistant" };
  // A thinking message without reasoning parts shows as plain text with a header, as on desktop.
  return { kind: "system" };
};

/**
 * True for OpenCode system text that is not an instruction message, such as a Plan mode reminder.
 * As on desktop, it folds into a "Show system message" box. Other runtimes show it as plain text.
 */
export const foldsSystemText = (message: AgentChatMessage, runtimeKind: RuntimeKind): boolean =>
  message.role === "system" &&
  runtimeKind === "opencode" &&
  resolveInstructionsMessage(message, "") === null;

const isSystemPromptRow = (row: AgentChatTranscriptRow): boolean =>
  row.kind === "message" &&
  row.message.role === "system" &&
  row.message.content.startsWith(SYSTEM_PROMPT_PREFIX);

/**
 * The rows that a phone shows. The system prompt is long setup text, so the mobile transcript
 * leaves it out. The list keeps the same array while no row is removed.
 */
export const mobileTranscriptRows = (
  rows: readonly AgentChatTranscriptRow[],
): readonly AgentChatTranscriptRow[] =>
  rows.some(isSystemPromptRow) ? rows.filter((row) => !isSystemPromptRow(row)) : rows;
