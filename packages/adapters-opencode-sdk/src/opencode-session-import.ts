import { z } from "zod";
import type { RuntimeSessionImportPort } from "@openducktor/core";
import { workspaceSessionExternalSchema, type WorkspaceSession } from "@openducktor/contracts";
import { unwrapData } from "./data-utils";
import type { ClientFactory } from "./types";

const metadataSchema = z.object({
  id: z.string().min(1),
  parentID: z.string().optional(),
  title: z.string(),
  agent: z.string().optional(),
  model: z
    .object({ id: z.string(), providerID: z.string(), variant: z.string().optional() })
    .optional(),
  time: z.object({ updated: z.number().int() }),
  location: z.object({ directory: z.string().min(1), workspaceID: z.string().optional() }),
});
const pageSchema = z.object({
  data: z.array(metadataSchema),
  cursor: z.object({ next: z.string().nullish() }),
});
const metadata = (row: z.infer<typeof metadataSchema>) =>
  workspaceSessionExternalSchema.parse({
    externalSessionId: row.id,
    runtimeKind: "opencode",
    workingDirectory: row.location.directory,
    title: row.title || null,
    updatedAt: row.time.updated,
  });

export const createOpenCodeSessionImportPort = (input: {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  admit: (ref: Parameters<RuntimeSessionImportPort["verifyImportSource"]>[0]) => Promise<void>;
}): RuntimeSessionImportPort => {
  const client = input.createClient({ runtimeEndpoint: input.runtimeEndpoint });
  const read = async (ref: Parameters<RuntimeSessionImportPort["verifyImportSource"]>[0]) => {
    const row = metadataSchema.parse(
      unwrapData(
        await client.v2.session.get({ sessionID: ref.externalSessionId }),
        "read session metadata",
      ).data,
    );
    if (row.parentID || row.location.workspaceID)
      throw new Error("Only local root conversations can be imported.");
    if (row.id !== ref.externalSessionId || row.location.directory !== ref.workingDirectory)
      throw new Error("The source conversation identity or directory changed. Reload sessions.");
    return row;
  };
  return {
    listRootSessionMetadataPage: async ({ pageToken, signal }) => {
      if (!client.v2?.session)
        throw new Error("Update OpenCode to a version with the V2 session listing API.");
      const request: Parameters<typeof client.v2.session.list>[0] = { limit: 100, order: "desc" };
      if (pageToken) request.cursor = pageToken;
      const page = pageSchema.parse(
        unwrapData(await client.v2.session.list(request, { signal }), "list external sessions"),
      );
      return {
        sessions: page.data
          .filter((row) => !row.parentID && !row.location.workspaceID)
          .map(metadata),
        nextPageToken: page.cursor.next ?? null,
      };
    },
    verifyImportSource: async (ref) => metadata(await read(ref)),
    openExistingSessionForImport: async (ref) => {
      const row = await read(ref);
      const selectedModel: WorkspaceSession["selectedModel"] = row.model
        ? {
            runtimeKind: "opencode",
            providerId: row.model.providerID,
            modelId: row.model.id,
          }
        : null;
      if (selectedModel && row.agent) selectedModel.profileId = row.agent;
      if (selectedModel && row.model?.variant) selectedModel.variant = row.model.variant;
      return {
        metadata: metadata(row),
        selectedModel,
        registerLiveSession: () => input.admit(ref),
        releaseImportResources: async () => {},
      };
    },
  };
};
