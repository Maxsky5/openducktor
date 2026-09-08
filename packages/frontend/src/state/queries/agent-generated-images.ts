import { batchImagePreview } from "@/lib/generated-images/image-preview-batches";
import { runImagePreview } from "@/lib/generated-images/image-preview-queue";
import { decodeGeneratedImage } from "@/lib/generated-images/image-worker-client";
import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

export type AgentGeneratedImageQueryInput = AgentGeneratedImageReadInput;

export const agentGeneratedImageQueryKeys = {
  all: ["agent-generated-images"] as const,
  image: (input: AgentGeneratedImageQueryInput) =>
    [...agentGeneratedImageQueryKeys.all, ...imageReadIdentity(input)] as const,
};

export const agentGeneratedImageQueryOptions = (
  input: AgentGeneratedImageQueryInput,
  reader: Pick<
    AgentEnginePort,
    "readGeneratedImage" | "beginGeneratedImageBatch" | "releaseGeneratedImageBatch"
  >,
) =>
  queryOptions({
    queryKey: agentGeneratedImageQueryKeys.image(input),
    queryFn: ({ signal }): Promise<Blob> =>
      batchImagePreview(reader, input, signal, (request) =>
        runImagePreview(signal, async () => {
          signal.throwIfAborted();
          const result = await reader.readGeneratedImage(request);
          signal.throwIfAborted();
          if (
            JSON.stringify(imageReadIdentity(result)) !== JSON.stringify(imageReadIdentity(request))
          ) {
            throw new Error(
              "The image response belongs to another session, item, or output revision. Reopen this session.",
            );
          }
          const bytes = await decodeGeneratedImage(
            { base64: result.base64, mime: result.mime, byteLength: result.byteLength },
            signal,
          );
          signal.throwIfAborted();
          return new Blob([bytes], { type: result.mime });
        }),
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

const imageReadIdentity = ({ ref, itemId, turnId, revision }: AgentGeneratedImageReadInput) =>
  [
    ref.repoPath,
    ref.runtimeKind,
    ref.workingDirectory,
    ref.externalSessionId,
    turnId ?? null,
    itemId,
    revision,
  ] as const;
