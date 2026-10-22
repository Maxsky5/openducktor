import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type {
  ClaudeTranscriptWorkerBatch,
  ClaudeTranscriptWorkerFailureReason,
  ClaudeTranscriptWorkerOptions,
  ClaudeTranscriptWorkerReply,
} from "./claude-transcript-worker-protocol";

const workerUrl = new URL(
  import.meta.url.endsWith(".ts")
    ? "./claude-transcript-worker.ts"
    : "./claude-transcript-worker.js",
  import.meta.url,
);

export class ClaudeTranscriptWorkerBatchError extends Error {
  constructor(
    readonly slotIndex: number,
    readonly lineIndex: number,
    readonly reason: ClaudeTranscriptWorkerFailureReason,
    cause: Error,
  ) {
    super(cause.message, { cause });
    this.name = "ClaudeTranscriptWorkerBatchError";
  }
}

type Pending = {
  resolve: (batch: ClaudeTranscriptWorkerBatch) => void;
  reject: (cause: HostOperationError) => void;
};
type Channel = { worker: Worker; pending: Pending | undefined; exited: boolean };
type Slot = {
  parse(buffer: ArrayBuffer, byteLength: number): Promise<ClaudeTranscriptWorkerBatch>;
};
export type ClaudeTranscriptWorkerPool = { slots: readonly Slot[]; close(): Promise<void> };

const workerFailure = (phase: string, cause?: unknown) =>
  new HostOperationError({
    operation: `claude.transcript.worker.${phase}`,
    message: "Cannot read the Claude transcript in a worker. Load the session again.",
    cause,
  });

const isWorkerFailure = (cause: unknown): cause is HostOperationError =>
  cause instanceof HostOperationError && cause.details === undefined;

export const createClaudeTranscriptWorkerPool = (
  options: ClaudeTranscriptWorkerOptions = {},
): Effect.Effect<ClaudeTranscriptWorkerPool, HostOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const channels: Channel[] = [];
      let failure: HostOperationError | undefined;
      let closed = false;
      let closing: Promise<void> | undefined;
      let closeFailure: HostOperationError | undefined;

      const beginClose = () => {
        if (closed) return;
        closed = true;
        for (const channel of channels) {
          const pending = channel.pending;
          channel.pending = undefined;
          pending?.reject(failure ?? workerFailure("closed"));
        }
        closing = Promise.allSettled(
          channels.map(async ({ worker, exited }) => (exited ? 0 : worker.terminate())),
        ).then((results) => {
          for (const result of results) {
            if (result.status === "rejected")
              closeFailure ??= workerFailure("terminate", result.reason);
          }
        });
      };
      const close = async () => {
        beginClose();
        await closing;
        if (closeFailure) throw closeFailure;
      };
      const fail = (cause: HostOperationError) => {
        failure ??= cause;
        beginClose();
      };
      const createSlot = (slotIndex: number): Slot => {
        const worker = new Worker(workerUrl, {
          name: "openducktor-claude-transcript",
          workerData: options,
        });
        const channel: Channel = { worker, pending: undefined, exited: false };
        channels.push(channel);
        worker.on("error", (cause) => fail(workerFailure("start", cause)));
        worker.on("messageerror", (cause) => fail(workerFailure("message", cause)));
        worker.on("exit", (code) => {
          channel.exited = true;
          if (!closed)
            fail(workerFailure("exit", new Error(`The worker exited with code ${code}.`)));
        });
        worker.on("message", (reply: ClaudeTranscriptWorkerReply) => {
          if (closed) return;
          const pending = channel.pending;
          if (!pending) {
            fail(workerFailure("protocol"));
            return;
          }
          if (reply.kind === "error") {
            fail(
              workerFailure(
                "parse",
                new ClaudeTranscriptWorkerBatchError(
                  slotIndex,
                  reply.error.lineIndex,
                  reply.error.reason,
                  reply.error.cause,
                ),
              ),
            );
            return;
          }
          channel.pending = undefined;
          pending.resolve(reply);
        });
        return {
          parse: (buffer, byteLength) =>
            new Promise((resolve, reject) => {
              if (closed || failure) {
                reject(failure ?? workerFailure("closed"));
                return;
              }
              if (channel.pending) {
                reject(workerFailure("busy"));
                return;
              }
              channel.pending = { resolve, reject };
              try {
                worker.postMessage({ buffer, byteLength }, [buffer]);
              } catch (cause) {
                fail(workerFailure("send", cause));
              }
            }),
        };
      };
      try {
        const slots = [createSlot(0), createSlot(1), createSlot(2), createSlot(3)];
        return { slots, close };
      } catch (cause) {
        fail(workerFailure("start", cause));
        await close();
        throw failure;
      }
    },
    catch: (cause) => (isWorkerFailure(cause) ? cause : workerFailure("start", cause)),
  });
