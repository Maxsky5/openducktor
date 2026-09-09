import type {
  AgentGeneratedImageDescribeInput,
  AgentGeneratedImageReadInput,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import type { AgentGeneratedImageReadPort } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";
import { runImagePreview } from "@/lib/generated-images/image-preview-queue";

export type GeneratedImageMetadataInput = Omit<
  AgentGeneratedImageReadInput,
  "revision" | "batchId"
>;
export const generatedImageMetadataSessionKey = (ref: AgentSessionLiveRef) =>
  [
    "agent-generated-image-metadata",
    ref.repoPath,
    ref.runtimeKind,
    ref.workingDirectory,
    ref.externalSessionId,
  ] as const;

export const generatedImageMetadataQueryOptions = (
  input: GeneratedImageMetadataInput,
  reader: Pick<AgentGeneratedImageReadPort, "describeGeneratedImages">,
) =>
  queryOptions({
    queryKey: [...generatedImageMetadataSessionKey(input.ref), input.turnId ?? null, input.itemId],
    queryFn: ({ signal }) =>
      runImagePreview(signal, async () => {
        const identity: AgentGeneratedImageDescribeInput["images"][number] = {
          itemId: input.itemId,
        };
        if (input.turnId !== undefined) identity.turnId = input.turnId;
        const result = await reader.describeGeneratedImages({ ref: input.ref, images: [identity] });
        signal.throwIfAborted();
        const part = result.images[0];
        if (
          JSON.stringify(generatedImageMetadataSessionKey(result.ref)) !==
            JSON.stringify(generatedImageMetadataSessionKey(input.ref)) ||
          result.images.length !== 1 ||
          !part ||
          part.itemId !== input.itemId ||
          part.turnId !== input.turnId
        )
          throw new Error("Image metadata belongs to another session or item. Reopen the session.");
        if (!part.output)
          throw new Error(
            part.previewUnavailableReason ?? "Preview unavailable. Check the runtime output file.",
          );
        return part.output;
      }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
