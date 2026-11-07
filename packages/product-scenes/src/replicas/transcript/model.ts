// The data of a session transcript: the rows of each turn, and the questions of a pending request.

export type ToolKind = "read" | "search" | "bash" | "tool";

/** One answer of an answered request_user_input row. */
export type Answer = { prompt: string; answer: string };

/** One transcript row. Each kind has the component of its product source. */
export type Row =
  | { kind: "user"; id: string; time: string; text: string }
  | {
      kind: "tool";
      id: string;
      tool: ToolKind;
      name: string;
      args: string;
      duration: string;
      time: string;
      answers?: readonly Answer[];
    }
  | { kind: "workflow"; id: string; name: string; duration: string; time: string }
  | { kind: "patch"; id: string; path: string; change: "A" | "M"; add: number; del: number }
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
