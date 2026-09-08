import { AsyncResource } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import { HostOperationError, HostValidationError, type HostError } from "../../effect/host-errors";
import {
  generatedImageWorkerReplySchema,
  type GeneratedImageWorkerRequest,
  type GeneratedImageWorkerResponse,
} from "./generated-image-worker-protocol";

const workerUrl = import.meta.url.endsWith(".ts")
  ? new URL("./generated-image-worker.ts", import.meta.url)
  : new URL("./generated-image-worker.js", import.meta.url);

export const imageWorkerFailure = (
  itemId: string,
  phase: string,
  cause?: unknown,
  exitCode?: number,
) =>
  new HostOperationError({
    operation: "generated-image.read",
    details: { itemId, phase, exitCode },
    cause,
    message: `Image '${itemId}' could not be prepared. Reopen the session and try the preview again.`,
  });

type WorkerFailure = { phase: string; cause?: unknown; exitCode?: number };
export type GeneratedImageWorkerChannel = {
  worker: Worker;
  failure: WorkerFailure | undefined;
  nextId: number;
};

export const acquireGeneratedImageWorker = (
  onTerminationFailure: (failure: ReturnType<typeof imageWorkerFailure>) => Effect.Effect<void>,
) =>
  Effect.acquireRelease(
    Effect.try({
      try: (): GeneratedImageWorkerChannel => {
        const worker = new Worker(workerUrl, { name: "openducktor-image" });
        const channel: GeneratedImageWorkerChannel = { worker, failure: undefined, nextId: 0 };
        // Keep an error listener while idle and during termination, when no request owns a listener.
        worker.on("error", (cause) => {
          channel.failure = { phase: "worker", cause };
        });
        worker.on("messageerror", (cause) => {
          channel.failure = { phase: "message", cause };
        });
        worker.on("exit", (exitCode) => {
          channel.failure ??= { phase: "exit", exitCode };
        });
        return channel;
      },
      catch: (cause) => imageWorkerFailure("worker", "start", cause),
    }),
    ({ worker }) =>
      Effect.tryPromise({
        try: () => worker.terminate(),
        catch: (cause) => imageWorkerFailure("worker", "terminate", cause),
      }).pipe(Effect.catchAll(onTerminationFailure)),
  );

export const exchangeImageWorkerMessage = (
  channel: GeneratedImageWorkerChannel,
  request: GeneratedImageWorkerRequest,
  itemId: string,
  expectedKind: Exclude<GeneratedImageWorkerResponse["kind"], "invalid">,
): Effect.Effect<GeneratedImageWorkerResponse, HostError> =>
  Effect.async((resume) => {
    if (channel.failure) {
      const { phase, cause, exitCode } = channel.failure;
      resume(Effect.fail(imageWorkerFailure(itemId, phase, cause, exitCode)));
      return;
    }
    const { worker } = channel;
    const id = channel.nextId++;
    const task = new AsyncResource("OpenDucktorImageWorkerRequest");
    const cleanup = () => {
      worker.off("message", message);
      worker.off("error", error);
      worker.off("exit", exit);
      worker.off("messageerror", messageError);
      task.emitDestroy();
    };
    const finish = (result: Effect.Effect<GeneratedImageWorkerResponse, HostError>) => {
      cleanup();
      task.runInAsyncScope(resume, undefined, result);
    };
    const error = (cause: unknown) =>
      finish(Effect.fail(imageWorkerFailure(itemId, "worker", cause)));
    const exit = (code: number) =>
      finish(Effect.fail(imageWorkerFailure(itemId, "exit", undefined, code)));
    const messageError = (cause: unknown) =>
      finish(Effect.fail(imageWorkerFailure(itemId, "message", cause)));
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This worker I/O boundary parses each untrusted message before use.
    const message = (raw: unknown) => {
      const parsed = generatedImageWorkerReplySchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== id) {
        finish(Effect.fail(imageWorkerFailure(itemId, "protocol")));
        return;
      }
      const { result } = parsed.data;
      if (result.kind === "invalid")
        finish(
          Effect.fail(
            new HostValidationError({
              field: "image",
              message: result.message,
              details: { itemId, operation: "generated-image.read" },
            }),
          ),
        );
      else if (result.kind !== expectedKind)
        finish(Effect.fail(imageWorkerFailure(itemId, "protocol")));
      else finish(Effect.succeed(result));
    };
    worker.once("message", message);
    worker.once("error", error);
    worker.once("exit", exit);
    worker.once("messageerror", messageError);
    try {
      worker.postMessage({ id, request }, request.kind === "file" ? [request.bytes.buffer] : []);
    } catch (cause) {
      finish(Effect.fail(imageWorkerFailure(itemId, "send", cause)));
    }
    return Effect.sync(cleanup);
  });
