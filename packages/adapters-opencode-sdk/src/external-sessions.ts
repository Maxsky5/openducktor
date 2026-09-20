import { z } from "zod";
import type { ExternalRuntimeSessionsPort } from "@openducktor/core";
import { workspaceSessionExternalSchema } from "@openducktor/contracts";
import { unwrapData } from "./data-utils";
import type { ClientFactory } from "./types";

const metadataSchema = z.object({
  id: z.string().min(1),
  parentID: z.string().optional(),
  title: z.string(),
  time: z.object({ updated: z.number().int() }),
  location: z.object({ directory: z.string().min(1), workspaceID: z.string().optional() }),
});
const pageSchema = z.object({
  data: z.array(metadataSchema),
  cursor: z.object({ next: z.string().optional() }),
});
const metadata = (row: z.infer<typeof metadataSchema>) =>
  workspaceSessionExternalSchema.parse({
    externalSessionId: row.id,
    runtimeKind: "opencode",
    workingDirectory: row.location.directory,
    title: row.title || null,
    updatedAt: row.time.updated,
  });

export const createOpenCodeExternalSessions = (input: {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  admit: (ref: Parameters<ExternalRuntimeSessionsPort["inspect"]>[0]) => Promise<void>;
}): ExternalRuntimeSessionsPort => {
  const client = input.createClient({ runtimeEndpoint: input.runtimeEndpoint });
  const inspect: ExternalRuntimeSessionsPort["inspect"] = async (ref) => {
    const row = metadataSchema.parse(
      unwrapData(
        await client.v2.session.get({ sessionID: ref.externalSessionId }),
        "inspect external session",
      ),
    );
    if (row.parentID || row.location.workspaceID)
      throw new Error("Only local root conversations can be imported.");
    if (row.id !== ref.externalSessionId || row.location.directory !== ref.workingDirectory)
      throw new Error("The source conversation identity or directory changed. Reload sessions.");
    return metadata(row);
  };
  return {
    list: async ({ cursor, signal }) => {
      if (!client.v2?.session)
        throw new Error("Update OpenCode to a version with the V2 session listing API.");
      const request: Parameters<typeof client.v2.session.list>[0] = { limit: 100 };
      if (cursor) request.cursor = cursor;
      const page = pageSchema.parse(
        unwrapData(await client.v2.session.list(request, { signal }), "list external sessions"),
      );
      return {
        sessions: page.data
          .filter((row) => !row.parentID && !row.location.workspaceID)
          .map(metadata),
        nextCursor: page.cursor.next ?? null,
      };
    },
    inspect,
    prepare: async (ref) => ({
      metadata: await inspect(ref),
      commit: () => input.admit(ref),
      dispose: async () => {},
    }),
  };
};
