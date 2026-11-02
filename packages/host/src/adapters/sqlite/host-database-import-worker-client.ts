import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import { siblingWorkerUrl } from "../../infrastructure/sibling-worker-url";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import {
  HostDatabaseImportSourceError,
  type HostDatabaseImportWorkerInput,
  hostDatabaseImportWorkerReplySchema,
} from "./host-database-import-worker-protocol";

type HostDatabaseImportWorkerError = HostDatabaseImportSourceError | HostOperationError;

const workerUrl = siblingWorkerUrl(import.meta.url, "host-database-import-worker");

/**
 * Runs the legacy import on a worker thread. The SQLite drivers block their thread, and a large
 * import takes seconds to minutes, so the host thread stays free to answer the shell.
 */
export const runHostDatabaseImportWorker = (
  input: HostDatabaseImportWorkerInput,
): Effect.Effect<void, HostDatabaseImportWorkerError> =>
  Effect.callback<void, HostDatabaseImportWorkerError>((resume) => {
    let settled = false;
    const settle = (effect: Effect.Effect<void, HostDatabaseImportWorkerError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    const worker = new Worker(workerUrl, {
      name: "openducktor-host-database-import",
      workerData: input,
    });
    worker.on("message", (raw) => {
      const parsed = hostDatabaseImportWorkerReplySchema.safeParse(raw);
      if (!parsed.success) {
        settle(
          Effect.fail(
            new HostOperationError({
              operation: "hostDatabase.import",
              message: `The host database import worker sent an invalid reply: ${parsed.error.message} Reinstall OpenDucktor, then restart it to retry. The original data is unchanged.`,
              cause: parsed.error,
            }),
          ),
        );
        return;
      }
      const reply = parsed.data;
      if (reply.kind === "complete") {
        settle(Effect.void);
        return;
      }
      settle(
        Effect.fail(
          reply.kind === "sourceError"
            ? new HostDatabaseImportSourceError({
                sourcePath: reply.sourcePath,
                message: reply.message,
              })
            : new HostOperationError({ operation: reply.operation, message: reply.message }),
        ),
      );
    });
    worker.on("error", (cause) =>
      settle(
        Effect.fail(
          new HostOperationError({
            operation: "hostDatabase.import",
            message: `The host database import failed: ${errorMessage(cause)} Restart OpenDucktor to retry. The original data is unchanged.`,
            cause,
          }),
        ),
      ),
    );
    worker.on("exit", (code) =>
      settle(
        Effect.fail(
          new HostOperationError({
            operation: "hostDatabase.import",
            message: `The host database import stopped with exit code ${code} before it finished. Restart OpenDucktor to retry. The original data is unchanged.`,
          }),
        ),
      ),
    );
    return Effect.promise(() => worker.terminate()).pipe(Effect.asVoid);
  });
