import type { GlobalConfig } from "@openducktor/contracts";
import { Data } from "effect";
import { z } from "zod";

export type HostDatabaseImportWorkerInput = {
  readonly config: GlobalConfig;
  readonly configRoot: string;
  readonly databasePath: string;
};

/** A legacy source that the import cannot read or migrate. The user corrects `sourcePath`. */
export class HostDatabaseImportSourceError extends Data.TaggedError(
  "HostDatabaseImportSourceError",
)<{
  readonly sourcePath: string;
  readonly message: string;
  readonly cause?: unknown | undefined;
}> {}

/** A source failure keeps its path, so the shell can name the source to correct. */
export const hostDatabaseImportWorkerReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete") }),
  z.object({ kind: z.literal("sourceError"), sourcePath: z.string(), message: z.string() }),
  z.object({ kind: z.literal("error"), operation: z.string(), message: z.string() }),
]);
export type HostDatabaseImportWorkerReply = z.infer<typeof hostDatabaseImportWorkerReplySchema>;
