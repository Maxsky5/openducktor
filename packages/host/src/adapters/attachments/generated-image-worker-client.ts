import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparer,
  type CodexImageGenerationPreparation,
} from "@openducktor/adapters-codex-app-server";
import { Deferred, Effect, Either, Exit, Pool, Scope } from "effect";
import { readSavedImage } from "./generated-image-saved-file";
import {
  causeToHostBoundaryError,
  toHostOperationError,
  type HostError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type { GeneratedImagePayload } from "../../ports/generated-image-file-port";
import {
  acquireGeneratedImageWorker,
  exchangeImageWorkerMessage,
  imageWorkerFailure,
  type GeneratedImageWorkerChannel,
} from "./generated-image-worker-channel";
import type { GeneratedImagePayloadRequest } from "./generated-image-worker-protocol";

const HISTORY_CHUNK_CHARACTERS = 1024 * 1024;
const MAX_ADMITTED_JOBS = 8;
const JOB_DEADLINE = "30 seconds";

export type GeneratedImageWorkers = {
  preparePayload(
    request: Effect.Effect<GeneratedImagePayloadRequest, HostError>,
    itemId: string,
  ): Effect.Effect<GeneratedImagePayload, HostError>;
  prepareHistory: CodexImageGenerationPreparer;
  shutdown: Effect.Effect<void, HostError>;
};

const prepareHistoryImage = (
  channel: GeneratedImageWorkerChannel,
  image: CodexImageGenerationPreparation,
) =>
  Effect.gen(function* () {
    const { item, context } = image;
    if (item.status === "completed" && item.savedPath !== undefined) {
      const read = yield* Effect.either(readSavedImage(item.savedPath, item.id));
      if (Either.isLeft(read))
        return {
          ...codexImageGenerationPart(item, context),
          previewUnavailableReason: read.left.message,
        };
      const result = yield* exchangeImageWorkerMessage(
        channel,
        {
          kind: "file-revision",
          bytes: read.right,
          itemId: item.id,
        },
        item.id,
        "revision",
      );
      if (result.kind !== "revision") return yield* imageWorkerFailure(item.id, "protocol");
      return codexImageGenerationPart(item, context, result.revision);
    }
    yield* exchangeImageWorkerMessage(
      channel,
      {
        kind: "history-start",
        image: { item: { ...item, result: "" }, context },
        hasInlineOutput: item.result.length > 0,
      },
      item.id,
      "ack",
    );
    if (item.status === "completed" && item.savedPath === undefined) {
      let offset = 0;
      while (offset < item.result.length) {
        let end = Math.min(offset + HISTORY_CHUNK_CHARACTERS, item.result.length);
        // Match whole-string UTF-8 encoding when a surrogate pair crosses a chunk boundary.
        const tail = item.result.charCodeAt(end - 1);
        if (end < item.result.length && tail >= 0xd800 && tail <= 0xdbff) end--;
        yield* exchangeImageWorkerMessage(
          channel,
          { kind: "history-chunk", chunk: item.result.slice(offset, end) },
          item.id,
          "ack",
        );
        offset = end;
      }
    }
    const result = yield* exchangeImageWorkerMessage(
      channel,
      { kind: "history-end" },
      item.id,
      "history",
    );
    if (result.kind !== "history") return yield* imageWorkerFailure(item.id, "protocol");
    return result.part;
  });

/** The host owns this pool and must await shutdown before it exits. */
export const createGeneratedImageWorkers = (
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const closing = yield* Deferred.make<never, HostError>();
    let closed = false;
    let terminationFailure: ReturnType<typeof imageWorkerFailure> | undefined;
    const reportTerminationFailure = (failure: ReturnType<typeof imageWorkerFailure>) =>
      Effect.gen(function* () {
        terminationFailure ??= failure;
        yield* Deferred.fail(closing, failure);
        yield* onBackgroundFailure(failure);
      });
    let admitted = 0;
    const pool = yield* Pool.makeWithTTL({
      acquire: acquireGeneratedImageWorker(reportTerminationFailure),
      min: 0,
      max: 2,
      targetUtilization: 1,
      timeToLive: "30 seconds",
    }).pipe(
      Effect.interruptible,
      Scope.extend(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        closed = true;
        yield* Deferred.fail(closing, imageWorkerFailure("worker", "shutdown"));
      }),
    );

    const run = <A>(
      itemId: string,
      use: (channel: GeneratedImageWorkerChannel) => Effect.Effect<A, HostError>,
    ): Effect.Effect<A, HostError> =>
      Effect.acquireUseRelease(
        Effect.suspend(() => {
          if (terminationFailure) return Effect.fail(terminationFailure);
          if (closed) return Effect.fail(imageWorkerFailure(itemId, "shutdown"));
          if (admitted >= MAX_ADMITTED_JOBS)
            return Effect.fail(imageWorkerFailure(itemId, "capacity"));
          admitted++;
          return Effect.void;
        }),
        () => {
          const job = Effect.scoped(
            Effect.gen(function* () {
              const channel = yield* Pool.get(pool);
              return yield* use(channel).pipe(
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) ? Pool.invalidate(pool, channel) : Effect.void,
                ),
              );
            }),
          );
          return Effect.raceFirst(job, Deferred.await(closing)).pipe(
            Effect.timeoutFail({
              duration: JOB_DEADLINE,
              onTimeout: () => imageWorkerFailure(itemId, "deadline"),
            }),
            Effect.catchAllDefect((cause) =>
              Effect.fail(toHostOperationError(cause, "generated-image.read")),
            ),
            Effect.withSpan("generated-image.prepare", { attributes: { itemId } }),
          );
        },
        () =>
          Effect.sync(() => {
            admitted--;
          }),
      );

    const preparePayload: GeneratedImageWorkers["preparePayload"] = (request, itemId) =>
      run(itemId, (channel) =>
        Effect.gen(function* () {
          // Acquire capacity before reading a file or allocating its buffer.
          const input = yield* request;
          const result = yield* exchangeImageWorkerMessage(
            channel,
            input,
            itemId,
            input.kind === "inline" ? "inline" : "payload",
          );
          if (input.kind === "inline" && result.kind === "inline")
            return {
              mime: "image/png" as const,
              byteLength: result.byteLength,
              base64: input.base64,
            };
          if (result.kind === "payload") return result.payload;
          return yield* imageWorkerFailure(itemId, "protocol");
        }),
      );

    // This Promise callback is the Codex adapter boundary. Preserve its caller's cancellation.
    const prepareHistory: CodexImageGenerationPreparer = async (
      images,
      signal,
      purpose = "history",
    ) => {
      const exit = await Effect.runPromiseExit(
        Effect.forEach(
          images,
          (image) =>
            purpose === "history" && image.item.savedPath !== undefined
              ? Effect.succeed(codexImageGenerationPart(image.item, image.context))
              : run(image.item.id, (channel) => prepareHistoryImage(channel, image)),
          { concurrency: 1 },
        ),
        signal ? { signal } : undefined,
      );
      if (Exit.isFailure(exit)) throw causeToHostBoundaryError(exit.cause);
      return exit.value;
    };
    return {
      preparePayload,
      prepareHistory,
      shutdown: Effect.gen(function* () {
        yield* Scope.close(scope, Exit.void);
        if (terminationFailure) return yield* terminationFailure;
      }).pipe(
        Effect.catchAllDefect((cause) =>
          Effect.fail(toHostOperationError(cause, "generated-image.shutdown")),
        ),
      ),
    } satisfies GeneratedImageWorkers;
  }).pipe(Effect.uninterruptible);
