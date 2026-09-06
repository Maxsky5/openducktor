import type {
  AgentGeneratedImageReadInput,
  AgentImageGenerationPart,
} from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

export type AgentGeneratedImageQueryInput = AgentGeneratedImageReadInput & {
  output: NonNullable<AgentImageGenerationPart["output"]>;
  savedPath?: string;
};

export const agentGeneratedImageQueryKeys = {
  all: ["agent-generated-images"] as const,
  image: (input: AgentGeneratedImageQueryInput) =>
    [
      ...agentGeneratedImageQueryKeys.all,
      ...imageReadIdentity(input),
      input.output,
      input.savedPath ?? null,
    ] as const,
};

export const agentGeneratedImageQueryOptions = (
  input: AgentGeneratedImageQueryInput,
  read: AgentEnginePort["readGeneratedImage"],
) =>
  queryOptions({
    queryKey: agentGeneratedImageQueryKeys.image(input),
    queryFn: async ({ signal }): Promise<Blob> => {
      signal.throwIfAborted();
      const request: AgentGeneratedImageReadInput = { ref: input.ref, itemId: input.itemId };
      if (input.turnId !== undefined) request.turnId = input.turnId;
      const result = await read(request);
      signal.throwIfAborted();
      if (
        JSON.stringify(imageReadIdentity(result)) !== JSON.stringify(imageReadIdentity(request))
      ) {
        throw new Error(
          "The image response belongs to another session or item. Reopen this session.",
        );
      }
      let decoded: string;
      try {
        decoded = atob(result.base64);
      } catch {
        throw new Error("The generated image data cannot be decoded. Check the runtime output.");
      }
      if (result.mime !== "image/png" || decoded.length !== result.byteLength) {
        throw new Error(
          "The generated image response has invalid content. Check the runtime output.",
        );
      }
      const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      signal.throwIfAborted();
      return new Blob([bytes], { type: result.mime });
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

const imageReadIdentity = ({ ref, itemId, turnId }: AgentGeneratedImageReadInput) =>
  [
    ref.repoPath,
    ref.runtimeKind,
    ref.workingDirectory,
    ref.externalSessionId,
    turnId ?? null,
    itemId,
  ] as const;
