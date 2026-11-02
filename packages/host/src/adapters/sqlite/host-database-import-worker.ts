import { parentPort, workerData } from "node:worker_threads";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import { errorMessage } from "../../effect/host-errors";
import {
  HostDatabaseImportSourceError,
  type HostDatabaseImportWorkerInput,
  type HostDatabaseImportWorkerReply,
} from "./host-database-import-worker-protocol";
import { importHostDatabase } from "./sqlite-host-database-import";
import { openHostDatabaseConnection } from "./sqlite-host-database-connection";

const port = parentPort;
if (!port) throw new Error("The host database import must run in a worker thread.");
// SAFETY: The import client supplies this input through the worker constructor.
const input = workerData as HostDatabaseImportWorkerInput;

const operationSchema = z.object({ operation: z.string() });

const toReply = (cause: Cause.Cause<unknown>): HostDatabaseImportWorkerReply => {
  const failure = Cause.squash(cause);
  if (failure instanceof HostDatabaseImportSourceError)
    return { kind: "sourceError", sourcePath: failure.sourcePath, message: failure.message };
  const parsed = operationSchema.safeParse(failure);
  return {
    kind: "error",
    operation: parsed.success ? parsed.data.operation : "hostDatabase.import",
    message: errorMessage(failure),
  };
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(
      openHostDatabaseConnection(input.databasePath),
      (opened) => opened.release.pipe(Effect.orDie),
    );
    yield* importHostDatabase({
      session: connection.session,
      configRoot: input.configRoot,
      config: input.config,
    });
  }),
);

void Effect.runPromiseExit(program).then((exit) => {
  const reply: HostDatabaseImportWorkerReply = Exit.isSuccess(exit)
    ? { kind: "complete" }
    : toReply(exit.cause);
  port.postMessage(reply);
});
