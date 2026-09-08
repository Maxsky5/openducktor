import type { CodexImageGenerationPreparer } from "@openducktor/adapters-codex-app-server";
import type {
  AgentImageGenerationPart,
  AgentGeneratedImageDescribeInput,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";

export const createHostImagePreparer =
  (
    host: Pick<HostClient, "agentSessionDescribeGeneratedImages">,
    prepareInline: CodexImageGenerationPreparer,
  ): CodexImageGenerationPreparer =>
  async (images, signal) => {
    signal?.throwIfAborted();
    const results = new Map<number, AgentImageGenerationPart>();
    const inline = images.flatMap((image, index) =>
      image.item.status === "completed" && image.item.savedPath !== undefined
        ? []
        : [{ image, index }],
    );
    const prepared = await prepareInline(
      inline.map(({ image }) => image),
      signal,
    );
    inline.forEach(({ index }, position) => {
      const part = prepared[position];
      if (!part)
        throw new Error("Image preparation returned incomplete results. Reload the session.");
      results.set(index, part);
    });
    const saved = images.flatMap((image, index) => (results.has(index) ? [] : [{ image, index }]));
    for (let offset = 0; offset < saved.length; offset += 64) {
      signal?.throwIfAborted();
      const batch = saved.slice(offset, offset + 64);
      const ref = batch[0]?.image.context.ref;
      if (
        !ref ||
        batch.some(({ image }) => JSON.stringify(image.context.ref) !== JSON.stringify(ref))
      )
        throw new Error("Saved image preparation requires one exact session. Reload the session.");
      const result = await host.agentSessionDescribeGeneratedImages({
        ref,
        images: batch.map(({ image }) => {
          const identity: AgentGeneratedImageDescribeInput["images"][number] = {
            itemId: image.item.id,
          };
          if (image.context.turnId !== undefined) identity.turnId = image.context.turnId;
          return identity;
        }),
      });
      signal?.throwIfAborted();
      if (
        result.ref.repoPath !== ref.repoPath ||
        result.ref.runtimeKind !== ref.runtimeKind ||
        result.ref.workingDirectory !== ref.workingDirectory ||
        result.ref.externalSessionId !== ref.externalSessionId ||
        result.images.length !== batch.length
      )
        throw new Error("Saved image preparation returned another session. Reload the session.");
      batch.forEach(({ image, index }, position) => {
        const part = result.images[position];
        if (!part || part.itemId !== image.item.id || part.turnId !== image.context.turnId)
          throw new Error("Saved image preparation returned another image. Reload the session.");
        results.set(index, part);
      });
    }
    return images.map((_, index) => {
      const part = results.get(index);
      if (!part)
        throw new Error("Image preparation returned incomplete results. Reload the session.");
      return part;
    });
  };
