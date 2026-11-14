import { createSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import {
  type AgentChatTranscriptRow,
  buildAgentChatTranscriptModel,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type {
  AgentChatMessage,
  AgentChatMessageMeta,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { WorkflowRoleId } from "@openducktor/workflows";
import { sampleTime, TASKS, WORKSPACES } from "./feature-tour-samples";

// The sample transcripts of the tour pictures: the real message shapes of a session, at fixed
// times before the sample clock, in the rows of the real transcript model.

const at = (minutesAgo: number): string => new Date(sampleTime(minutesAgo)).toISOString();

const assistantMessage = (
  id: string,
  content: string,
  minutesAgo: number,
  agentRole: WorkflowRoleId,
  /** The time of the turn. Only the last message of a turn has it: the chat shows its model line. */
  turnDurationMs: number | null,
): AgentChatMessage => {
  const meta: Extract<AgentChatMessageMeta, { kind: "assistant" }> = {
    kind: "assistant",
    agentRole,
    providerId: "openai",
    modelId: "gpt-6-astra",
    variant: "high",
    isFinal: turnDurationMs !== null,
  };
  if (turnDurationMs !== null) meta.durationMs = turnDurationMs;
  return { id, role: "assistant", content, timestamp: at(minutesAgo), meta };
};

type ToolMessageInput = {
  id: string;
  tool: string;
  toolType: "read" | "bash" | "workflow";
  title: string;
  minutesAgo: number;
  durationMs?: number;
  input: NonNullable<Extract<AgentChatMessageMeta, { kind: "tool" }>["input"]>;
};

const toolMessage = ({
  id,
  tool,
  toolType,
  title,
  minutesAgo,
  durationMs = 120,
  input,
}: ToolMessageInput): AgentChatMessage => {
  const startedAtMs = sampleTime(minutesAgo);
  return {
    id,
    role: "tool",
    content: title,
    timestamp: at(minutesAgo),
    meta: {
      kind: "tool",
      partId: id,
      callId: id,
      tool,
      toolType,
      status: "completed",
      title,
      input,
      startedAtMs,
      endedAtMs: startedAtMs + durationMs,
    },
  };
};

/** The transcript rows of a completed session with `messages`. */
const transcriptRows = (
  externalSessionId: string,
  messages: readonly AgentChatMessage[],
): AgentChatTranscriptRow[] =>
  buildAgentChatTranscriptModel(
    {
      externalSessionId,
      runtimeKind: "codex",
      workingDirectory: WORKSPACES.fieldnotes.repoPath,
      activityState: null,
      runtimeStatusMessage: null,
      messages: createSessionMessagesState(externalSessionId, messages),
      pendingQuestions: [],
    },
    { showThinkingMessages: false },
  ).rows;

const readMessage = (id: string, filePath: string, minutesAgo: number): AgentChatMessage =>
  toolMessage({
    id,
    tool: "Read",
    toolType: "read",
    title: filePath,
    minutesAgo,
    durationMs: 8,
    input: { file_path: filePath },
  });

const bashMessage = (
  id: string,
  command: string,
  minutesAgo: number,
  durationMs: number,
): AgentChatMessage =>
  toolMessage({
    id,
    tool: "Bash",
    toolType: "bash",
    title: command,
    minutesAgo,
    durationMs,
    input: { command },
  });

/** The end of the Builder session of `TASKS.shortcut`: it checks and commits the QA fixes. */
export const REVIEW_ROWS = transcriptRows("tour-review", [
  bashMessage("review-typecheck", "bun run typecheck", 10, 3000),
  bashMessage("review-test", "bun test src/search", 9, 2400),
  bashMessage("review-commit", 'git commit -m "fix(search): ignore Alt and open dialogs"', 8, 300),
  assistantMessage(
    "review-final",
    "I fixed the two QA findings and committed the change on the task branch.\n\nThe shortcut now ignores Alt, and it does nothing while another dialog is open.\n\nThe search tests and the typecheck pass.",
    8,
    "build",
    192_000,
  ),
]);

/** The end of the Spec session of `TASKS.titles`: it reads the code, then saves the spec. */
export const SPEC_ROWS = transcriptRows("tour-spec", [
  assistantMessage(
    "spec-intro",
    "I will read how the app stores notes, then write the spec.",
    9,
    "spec",
    null,
  ),
  readMessage("spec-read-note", "src/notes/note.ts", 8),
  readMessage("spec-read-list", "src/notes/note-list.tsx", 7),
  readMessage("spec-read-store", "src/notes/note-store.ts", 7),
  toolMessage({
    id: "spec-save",
    tool: "odt_set_task_artifact",
    toolType: "workflow",
    title: "Set Spec",
    minutesAgo: 5,
    input: { taskId: TASKS.titles.id, code: "spec" },
  }),
  assistantMessage(
    "spec-final",
    "I saved the spec on the task.\n\nSearch matches note titles as you type, ignores letter case, and shows the best matches first.",
    5,
    "spec",
    154_000,
  ),
]);

/** The spec of `TASKS.titles`, as the Spec role saves it. */
export const TITLES_SPEC = [
  "# Search by title",
  "",
  "**Goal:** find a note by its title.",
  "",
  "## Requirements",
  "",
  "| ID | Requirement |",
  "| --- | --- |",
  "| R1 | Results update as you type. |",
  "| R2 | Search ignores letter case. |",
  "| R3 | The best matches come first. |",
  "",
  "## Acceptance",
  "",
  "- [ ] Typing `gro` or `GRO` shows *Groceries*.",
  "- [ ] An exact title comes **first**.",
].join("\n");
