import type { TerminalServerMessage, TerminalSummary } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TerminalPtyHandle } from "../../ports/terminal-pty-port";
import type { TerminalTitleTracker } from "./terminal-title-tracker";

export type ReplayChunk = {
  sequenceStart: number;
  sequenceEnd: number;
  data: Uint8Array;
};

export type TerminalAttachment = {
  attachmentId: string;
  sink: (event: TerminalServerMessage, payload: Uint8Array) => void;
  acknowledgedSequence: number;
  deliveredSequence: number;
  pendingBytes: number;
};

export type TerminalSession = {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  handle: TerminalPtyHandle | null;
  replay: ReplayChunk[];
  replayBytes: number;
  nextSequence: number;
  attachments: Map<string, TerminalAttachment>;
  paused: boolean;
  overflowed: boolean;
  operations: Effect.Semaphore;
};

const disposedSessions = new WeakSet<TerminalSession>();

export const createTerminalSession = ({
  summary,
  titleTracker,
  operations,
}: {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  operations: Effect.Semaphore;
}): TerminalSession => ({
  summary,
  titleTracker,
  handle: null,
  replay: [],
  replayBytes: 0,
  nextSequence: 0,
  attachments: new Map(),
  paused: false,
  overflowed: false,
  operations,
});

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

export const activateTerminalSession = (
  session: TerminalSession,
  handle: TerminalPtyHandle,
): boolean => {
  if (session.summary.lifecycle !== "starting" || disposedSessions.has(session)) return false;
  session.handle = handle;
  session.summary.lifecycle = "running";
  return true;
};

export const beginTerminalClose = (session: TerminalSession): void => {
  session.summary.lifecycle = "closing";
};

export const markTerminalCloseFailed = (session: TerminalSession): void => {
  session.summary.lifecycle = "close_failed";
};

export const markTerminalOverflowed = (session: TerminalSession): boolean => {
  if (session.overflowed) return false;
  session.overflowed = true;
  return true;
};

export const disposeTerminalSession = (session: TerminalSession): void => {
  if (disposedSessions.has(session)) return;
  disposedSessions.add(session);
  session.titleTracker.dispose();
  session.handle = null;
};

export const exitTerminalSession = (
  session: TerminalSession,
  {
    exitCode,
    signal,
    exitedAt,
  }: { exitCode: number | null; signal: string | null; exitedAt: string },
): boolean => {
  if (session.summary.lifecycle === "exited") return false;
  disposeTerminalSession(session);
  session.summary.lifecycle = "exited";
  session.summary.exit = {
    exitCode,
    signal,
    finalSequence: session.nextSequence,
    exitedAt,
  };
  return true;
};
