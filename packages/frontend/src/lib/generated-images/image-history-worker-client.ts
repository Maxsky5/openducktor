import type { CodexImageGenerationPreparer } from "@openducktor/adapters-codex-app-server";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { createImageHistoryWorkerChannel } from "./image-history-worker-channel";
import { IMAGE_HISTORY_CHUNK_BYTES } from "./image-history-worker-protocol";

let active = 0;
const waiting: (() => void)[] = [];

const acquireWorker = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener("abort", abort);
      active++;
      resolve();
    };
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(signal?.reason);
    };
    if (active < 2) start();
    else {
      waiting.push(start);
      signal?.addEventListener("abort", abort, { once: true });
    }
  });

export const prepareCodexImageGenerations: CodexImageGenerationPreparer = async (
  images,
  signal,
) => {
  signal?.throwIfAborted();
  if (images.length === 0) return [];
  await acquireWorker(signal);
  try {
    signal?.throwIfAborted();
    const channel = createImageHistoryWorkerChannel(signal);
    try {
      const parts: AgentImageGenerationPart[] = [];
      const encoder = new TextEncoder();
      let id = 0;
      for (const { item, context } of images) {
        const inline =
          item.status === "completed" && item.savedPath === undefined && item.result.length > 0;
        await channel.send({
          id: id++,
          kind: "start",
          image: { item: { ...item, result: "" }, context },
          inline,
        });
        if (inline) {
          for (let offset = 0; offset < item.result.length;) {
            signal?.throwIfAborted();
            // Three UTF-8 bytes per UTF-16 code unit bounds even non-base64 input.
            let end = Math.min(
              offset + Math.floor(IMAGE_HISTORY_CHUNK_BYTES / 3),
              item.result.length,
            );
            const last = item.result.charCodeAt(end - 1);
            if (end < item.result.length && last >= 0xd800 && last <= 0xdbff) end--;
            const bytes = encoder.encode(item.result.slice(offset, end));
            await channel.send({ id: id++, kind: "chunk", bytes });
            offset = end;
          }
        }
        const response = await channel.send({ id: id++, kind: "end" });
        if (response.kind !== "part")
          throw new Error(
            "Image history preparation returned an invalid result. Reload this session.",
          );
        parts.push(response.part);
      }
      signal?.throwIfAborted();
      return parts;
    } finally {
      channel.close();
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
};
