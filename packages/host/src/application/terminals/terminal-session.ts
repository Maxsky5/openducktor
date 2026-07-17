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
  resources: TerminalSessionResources;
  output: TerminalSessionOutputState;
  operations: Effect.Semaphore;
};

export class TerminalSessionOutputState {
  private readonly replay: ReplayChunk[] = [];
  private replayBytes = 0;
  private sequence = 0;
  private readonly attachments = new Map<string, TerminalAttachment>();
  private outputPaused = false;
  private outputOverflowed = false;

  constructor(private readonly replayByteLimit: number) {}

  get nextSequence(): number {
    return this.sequence;
  }

  get earliestRetainedSequence(): number {
    return this.replay[0]?.sequenceStart ?? this.sequence;
  }

  get paused(): boolean {
    return this.outputPaused;
  }

  get overflowed(): boolean {
    return this.outputOverflowed;
  }

  get attachmentCount(): number {
    return this.attachments.size;
  }

  replayChunks(): readonly ReplayChunk[] {
    return this.replay;
  }

  attachmentValues(): IterableIterator<TerminalAttachment> {
    return this.attachments.values();
  }

  getAttachment(attachmentId: string): TerminalAttachment | undefined {
    return this.attachments.get(attachmentId);
  }

  setAttachment(attachment: TerminalAttachment): TerminalAttachment | undefined {
    const previous = this.attachments.get(attachment.attachmentId);
    this.attachments.set(attachment.attachmentId, attachment);
    return previous;
  }

  restoreAttachment(attachmentId: string, attachment: TerminalAttachment | undefined): void {
    if (attachment) this.attachments.set(attachmentId, attachment);
    else this.attachments.delete(attachmentId);
  }

  deleteAttachment(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  append(data: Uint8Array): ReplayChunk {
    const chunk = {
      sequenceStart: this.sequence,
      sequenceEnd: this.sequence + data.byteLength,
      data,
    };
    this.sequence = chunk.sequenceEnd;
    this.replay.push(chunk);
    this.replayBytes += data.byteLength;
    while (this.replayBytes > this.replayByteLimit) {
      const removed = this.replay.shift();
      if (!removed) break;
      this.replayBytes -= removed.data.byteLength;
    }
    return chunk;
  }

  pause(): void {
    this.outputPaused = true;
  }

  resume(): void {
    this.outputPaused = false;
  }

  markOverflowed(): boolean {
    if (this.outputOverflowed) return false;
    this.outputOverflowed = true;
    return true;
  }
}

export class TerminalSessionResources {
  private currentHandle: TerminalPtyHandle | null = null;
  private disposed = false;

  constructor(private readonly titleTracker: TerminalTitleTracker) {}

  get handle(): TerminalPtyHandle | null {
    return this.currentHandle;
  }

  activate(handle: TerminalPtyHandle): boolean {
    if (this.disposed) return false;
    this.currentHandle = handle;
    return true;
  }

  consumeOutput(data: Uint8Array): void {
    if (!this.disposed) this.titleTracker.consume(data);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.titleTracker.dispose();
    this.currentHandle = null;
  }
}

export const createTerminalSession = ({
  summary,
  titleTracker,
  operations,
  replayByteLimit,
}: {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  operations: Effect.Semaphore;
  replayByteLimit: number;
}): TerminalSession => ({
  summary,
  resources: new TerminalSessionResources(titleTracker),
  output: new TerminalSessionOutputState(replayByteLimit),
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
  if (session.summary.lifecycle !== "starting" || !session.resources.activate(handle)) return false;
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
  return session.output.markOverflowed();
};

export const disposeTerminalSession = (session: TerminalSession): void => {
  session.resources.dispose();
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
    finalSequence: session.output.nextSequence,
    exitedAt,
  };
  return true;
};
