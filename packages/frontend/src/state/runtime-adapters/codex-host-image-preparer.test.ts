import { expect, mock, test } from "bun:test";
import type { CodexImageGenerationPreparation } from "@openducktor/adapters-codex-app-server";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { createHostImagePreparer } from "./codex-host-image-preparer";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "thread",
};
const image = (saved: boolean): CodexImageGenerationPreparation => ({
  item: {
    type: "imageGeneration",
    id: saved ? "saved" : "inline",
    status: "completed",
    result: "private-inline",
    revisedPrompt: null,
    failure: null,
    savedPath: saved ? "/host-only.png" : undefined,
  },
  context: { turnId: "turn", ref },
});
const part = (itemId: string, revision: string): AgentImageGenerationPart => ({
  kind: "image_generation",
  messageId: itemId,
  partId: itemId,
  itemId,
  turnId: "turn",
  status: "completed",
  output: { revision },
});

test("saved metadata uses authenticated identities and preserves mixed result order", async () => {
  const describe = mock(async () => ({ ref, images: [part("saved", "file-content-digest")] }));
  const inline = mock(async (_images: readonly CodexImageGenerationPreparation[]) => [
    part("inline", "inline-digest"),
  ]);
  const prepare = createHostImagePreparer(
    { agentSessionDescribeGeneratedImages: describe },
    inline,
  );
  const images = [image(true), image(false)];
  expect(await prepare(images)).toEqual([
    part("saved", "file-content-digest"),
    part("inline", "inline-digest"),
  ]);
  expect(describe).toHaveBeenCalledTimes(1);
  expect(describe).toHaveBeenCalledWith({
    ref,
    images: [{ itemId: "saved", turnId: "turn" }],
  });
  expect(inline.mock.calls[0]?.[0]).toEqual([images[1]!]);
});

for (const failure of ["scope", "identity", "cancel"] as const) {
  test(`saved metadata rejects ${failure} after the host reply`, async () => {
    const reply = Promise.withResolvers<{ ref: typeof ref; images: AgentImageGenerationPart[] }>();
    const called = Promise.withResolvers<void>();
    const caller = new AbortController();
    const prepare = createHostImagePreparer(
      {
        agentSessionDescribeGeneratedImages: async () => {
          called.resolve();
          return reply.promise;
        },
      },
      async () => [],
    );
    const pending = prepare([image(true)], caller.signal);
    const result = Promise.allSettled([pending]);
    await called.promise;
    if (failure === "cancel") caller.abort(new Error("Cancelled"));
    reply.resolve({
      ref: failure === "scope" ? { ...ref, workingDirectory: "/other" } : ref,
      images: [part(failure === "identity" ? "other" : "saved", "digest")],
    });
    expect((await result)[0]?.status).toBe("rejected");
  });
}
