// The data of a session transcript: the rows of each turn, and the questions of a pending request.

/**
 * The tool type of a call, which picks its icon: toolIcon of agent-chat-tool-icon.tsx. Codex
 * runs its reads and its searches as shell commands, and they keep the icon of their action.
 */
export type ToolType =
  | "read"
  | "bash"
  | "list"
  | "search"
  | "web"
  | "file_edit"
  | "question"
  | "tool";

/**
 * A tool call as its line shows it: the icon of its tool, the name of the call, the first line of
 * its command or its summary, and its timing. readToolCallName of agent-chat-tool-presentation.ts
 * names a shell command `bash` and a file edit `edit`. The other calls keep the name of their
 * tool, such as `read_task`.
 */
export type Call = {
  tool: ToolType;
  name: string;
  /** The first line of a shell command, in the font of code. */
  command?: string;
  /** The summary of another call: a path, a task id, or a search. */
  summary?: string;
  /** The summary is the path of a file, and the icon of its type shows before it. */
  file?: boolean;
  /** The lines that a file edit adds and removes. */
  add?: number;
  del?: number;
  duration: string;
  time: string;
};

/** A call with the hook of its row. */
export type CallData = Call & { id: string };

/**
 * The icon of an ODT tool card: a saved document, a saved free artifact, a review verdict, a
 * workflow event, or a pull request. Sources: agent-chat-artifact-tool-message.tsx and
 * agent-chat-tool-icon.tsx.
 */
export type WorkflowIcon = "document" | "free" | "review_failed" | "workflow" | "pull_request";

/**
 * The answer of one question of a question tool. A tool with several questions shows the label of
 * each question before its answer: its header, or its prompt.
 */
export type Answer = { label: string; answer: string };

/**
 * One transcript row. Each kind has the component of its product source. Consecutive calls show
 * as one tool run.
 */
export type Row =
  | { kind: "user"; id: string; time: string; text: string }
  | ({ kind: "call" } & CallData)
  | {
      kind: "question";
      id: string;
      /** The prompt of one question, or the count of several questions. */
      summary: string;
      answers: readonly Answer[];
      duration: string;
      time: string;
    }
  | {
      kind: "workflow";
      id: string;
      /** The title of the ODT tool card, as agent-chat-workflow-tool-message.tsx shows it. */
      title: string;
      icon: WorkflowIcon;
      /** The pull request that a completed odt_set_pull_request call saved. */
      pr?: number;
      duration: string;
      time: string;
    }
  | {
      kind: "agent";
      id: string;
      signature: string;
      /** The time of the turn, which the separator before its final message shows. */
      worked?: string;
      paragraphs: readonly string[];
    };

/** One turn of a session: the rows of one prompt. */
type TurnData = { id: string; rows: readonly Row[] };

/** One session of a transcript, with the turns that the transcript holds. */
export type SessionData = { id: string; turns: readonly TurnData[] };

/** One question of a request_user_input, with the answer that the scene picks. */
export type Question = {
  header: string;
  question: string;
  options: readonly { label: string; description: string }[];
  answer: string;
};
