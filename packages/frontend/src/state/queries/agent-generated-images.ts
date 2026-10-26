import {
  assertGeneratedImageReadMatches,
  createGeneratedImageBatcher,
  generatedImageReadIdentity,
} from "@openducktor/frontend-core/queries/agent-generated-image-batches";
import { runImagePreview } from "@openducktor/frontend-core/lib/image-preview-queue";
import { decodeGeneratedImage } from "@/lib/generated-images/image-worker-client";
import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

export type AgentGeneratedImageQueryInput = AgentGeneratedImageReadInput;

const batchImagePreview = createGeneratedImageBatcher<Blob>();

export const agentGeneratedImageQueryKeys = {
  all: ["agent-generated-images"] as const,
  image: (input: AgentGeneratedImageQueryInput) =>
    [...agentGeneratedImageQueryKeys.all, ...generatedImageReadIdentity(input)] as const,
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
          assertGeneratedImageReadMatches(result, request);
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
