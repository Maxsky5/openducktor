import { Worker } from "node:worker_threads";
import type { CodexImageGenerationPreparer } from "@openducktor/adapters-codex-app-server";
import { Effect, Exit } from "effect";
import {
  HostOperationError,
  HostValidationError,
  causeToHostBoundaryError,
  type HostError,
} from "../../effect/host-errors";
import {
  generatedImageWorkerResponseSchema,
  type GeneratedImageWorkerRequest,
  type GeneratedImageWorkerResponse,
} from "./generated-image-worker-protocol";

// Source execution uses the TypeScript entry; Electron ships its adjacent JavaScript bundle.
const workerUrl = import.meta.url.endsWith(".ts")
  ? new URL("./generated-image-worker.ts", import.meta.url)
  : new URL("./generated-image-worker.js", import.meta.url);
const slots = Effect.unsafeMakeSemaphore(2);
const workerError = (itemId: string) =>
  new HostOperationError({
    operation: "generated-image.read",
    details: { itemId },
    message: `Image '${itemId}' could not be prepared. Reopen the session and try the preview again.`,
  });

const runWorker = (
  request: GeneratedImageWorkerRequest,
  itemId: string,
): Effect.Effect<GeneratedImageWorkerResponse, HostError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const worker = yield* Effect.try({
        try: () => new Worker(workerUrl),
        catch: () => workerError(itemId),
      });
      const result = yield* Effect.exit(
        restore(
          Effect.async<GeneratedImageWorkerResponse, HostError>((resume) => {
            worker.once("error", () => resume(Effect.fail(workerError(itemId))));
            worker.once("exit", () => resume(Effect.fail(workerError(itemId))));
            worker.once("messageerror", () => resume(Effect.fail(workerError(itemId))));
            worker.once("message", (raw: GeneratedImageWorkerResponse) => {
              const parsed = generatedImageWorkerResponseSchema.safeParse(raw);
              if (!parsed.success) resume(Effect.fail(workerError(itemId)));
              else if (parsed.data.kind === "invalid")
                resume(
                  Effect.fail(
                    new HostValidationError({
                      field: "image",
                      message: parsed.data.message,
                      details: { itemId, operation: "generated-image.read" },
                    }),
                  ),
                );
              else resume(Effect.succeed(parsed.data));
            });
            try {
              worker.postMessage(request);
            } catch {
              resume(Effect.fail(workerError(itemId)));
            }
          }),
        ),
      );
      worker.removeAllListeners();
      const stopped = yield* Effect.exit(
        Effect.tryPromise({ try: () => worker.terminate(), catch: () => workerError(itemId) }),
      );
      return yield* Exit.zipLeft(result, stopped);
    }),
  ).pipe(slots.withPermits(1));

export const prepareGeneratedImagePayload = (
  request: Exclude<GeneratedImageWorkerRequest, { kind: "history" }>,
) =>
  runWorker(request, request.itemId).pipe(
    Effect.flatMap((result) =>
      result.kind === "payload"
        ? Effect.succeed(result.payload)
        : Effect.fail(workerError(request.itemId)),
    ),
  );

// The Codex adapter owns this Promise callback contract.
export const prepareHostCodexImages: CodexImageGenerationPreparer = async (images) => {
  const itemId = images[0]?.item.id ?? "history";
  const exit = await Effect.runPromiseExit(
    runWorker({ kind: "history", images }, itemId).pipe(
      Effect.flatMap((result) =>
        result.kind === "history" ? Effect.succeed(result.parts) : Effect.fail(workerError(itemId)),
      ),
    ),
  );
  if (Exit.isFailure(exit)) throw causeToHostBoundaryError(exit.cause);
  return exit.value;
};
