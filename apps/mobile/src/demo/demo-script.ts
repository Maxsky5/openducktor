import type {
  AgentSessionLivePendingQuestionRequest,
  AgentToolData,
  AgentTranscriptSessionTodoItem,
  GitFileDiff,
} from "@openducktor/contracts";

/** The kind of a tool call, as the transcript shows it. */
export type DemoToolType = "bash" | "read" | "list" | "search" | "file_edit" | "workflow" | "todo";

/** One step of a scripted agent run. Each step shows as one part of the agent message. */
export type DemoRunStep =
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      tool: string;
      toolType: DemoToolType;
      title: string;
      input?: AgentToolData;
      output?: string;
      /** Changes and commits files when the call ends, and returns their diffs. */
      edit?: () => GitFileDiff[];
      /** The step runs only after the user allowed the edit of the run. */
      needsApproval?: boolean;
    }
  | { kind: "todos"; todos: AgentTranscriptSessionTodoItem[] }
  /** Waits for the user to allow or reject a file edit. */
  | { kind: "permission"; title: string; paths: string[] }
  /** Waits for the answer of the user. */
  | { kind: "question"; questions: AgentSessionLivePendingQuestionRequest["questions"] }
  /** The final answer. */
  | { kind: "text"; text: string };

export type DemoRunScript = {
  steps: DemoRunStep[];
  /** The final answer after the user rejected the edit. */
  rejectedText?: string;
  /** The role outcome. It applies only when the run ends normally. */
  onComplete?: () => void;
};

/** The first line of a prompt, which the final answer repeats. */
export const firstLine = (text: string): string => {
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim().length > 0)
      ?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

/** A prompt that asks for a change. Other prompts get an answer without file changes. */
export const asksForChange = (text: string): boolean =>
  /\b(add|change|create|edit|fix|implement|improve|make|move|refactor|remove|rename|replace|update|write)\b/i.test(
    text,
  );
