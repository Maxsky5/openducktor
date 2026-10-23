import { Worker } from "node:worker_threads";
import {
  artifactImagePreviewSchema,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type ArtifactImagePreview,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type {
  ArtifactImagePreviewInput,
  ArtifactImagePreviewPort,
} from "../../ports/artifact-image-preview-port";

const workerUrl = import.meta.url.endsWith(".ts")
  ? new URL("./artifact-image-preview-worker.ts", import.meta.url)
  : new URL("./artifact-image-preview-worker.js", import.meta.url);

/** Hold each job slot until its worker stops, even when the caller cancels. */
export const createArtifactImagePreviewAdapter = (): ArtifactImagePreviewPort => {
  let activeJobs = 0;
  return {
    previewArtifactImage: (input) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          if (activeJobs >= 2) return false;
          activeJobs++;
          return true;
        }),
        (admitted) => {
          if (!admitted) return Effect.succeed(failed("The image preview workers are busy."));
          if (input.content.byteLength > TASK_ARTIFACT_MAX_FILE_BYTES)
            return Effect.succeed(failed("The image exceeds the 10 MiB preview input limit."));
          return Effect.scoped(
            Effect.gen(function* () {
              const worker = yield* Effect.acquireRelease(
                Effect.try({
                  try: () =>
                    new Worker(workerUrl, {
                      name: "openducktor-artifact-preview",
                      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
                    }),
                  catch: (cause) => toHostOperationError(cause, "artifact.preview.start"),
                }),
                (worker) =>
                  Effect.tryPromise({
                    try: async () => {
                      await worker.terminate();
                      worker.removeAllListeners();
                    },
                    catch: (cause) => toHostOperationError(cause, "artifact.preview.stop"),
                  }).pipe(Effect.orDie),
              );
              return yield* runWorker(worker, input).pipe(
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () =>
                    Effect.succeed(failed("The image preview exceeded its time limit.")),
                }),
              );
            }),
          ).pipe(
            Effect.catch(() => Effect.succeed(failed("The image preview worker could not start."))),
            Effect.catchDefect(() => Effect.succeed(failed("The image preview worker failed."))),
          );
        },
        (admitted) =>
          Effect.sync(() => {
            if (admitted) activeJobs--;
          }),
      ),
  };
};

const failed = (message: string): ArtifactImagePreview => ({
  state: "failed",
  message,
  nextAction: "Download the original artifact or replace it with a smaller valid image.",
});

/** Keep the error listener until the owner stops the worker, even after a reply or cancellation. */
const runWorker = (worker: Worker, input: ArtifactImagePreviewInput) =>
  Effect.callback<ArtifactImagePreview>((resume) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      worker.off("message", onMessage);
      worker.off("messageerror", onError);
      worker.off("exit", onExit);
    };
    const finish = (result: ArtifactImagePreview) => {
      if (finished) return;
      cleanup();
      resume(Effect.succeed(result));
    };
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Worker replies require schema validation at the I/O boundary.
    const onMessage = (message: unknown) => {
      const result = artifactImagePreviewSchema.safeParse(message);
      finish(
        result.success
          ? result.data
          : failed("The image preview worker returned an invalid result."),
      );
    };
    const onError = () => finish(failed("The image preview worker failed to decode this image."));
    const onExit = () => finish(failed("The image preview worker stopped before it finished."));
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("messageerror", onError);
    worker.once("exit", onExit);
    try {
      // Transfer would detach the bytes still needed by the original read response.
      worker.postMessage(input);
    } catch {
      finish(failed("The image bytes could not be sent to the preview worker."));
    }
    return Effect.sync(cleanup);
  });
