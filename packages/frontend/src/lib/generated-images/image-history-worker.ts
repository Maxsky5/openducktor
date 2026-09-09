import {
  codexImageGenerationPart,
  createCodexInlineImageRevision,
  type CodexImageGenerationPreparation,
} from "@openducktor/adapters-codex-app-server";
import {
  IMAGE_HISTORY_CHUNK_BYTES,
  type ImageHistoryWorkerRequest,
  type ImageHistoryWorkerResponse,
} from "./image-history-worker-protocol";

let current:
  | {
      image: CodexImageGenerationPreparation;
      revision: ReturnType<typeof createCodexInlineImageRevision> | undefined;
    }
  | undefined;

self.onmessage = ({ data }: MessageEvent<ImageHistoryWorkerRequest>) => {
  try {
    let response: ImageHistoryWorkerResponse = { id: data.id, kind: "ack" };
    switch (data.kind) {
      case "start":
        if (current || data.image.item.result !== "")
          throw new Error("Invalid image history start.");
        current = {
          image: data.image,
          revision: data.inline ? createCodexInlineImageRevision() : undefined,
        };
        break;
      case "chunk":
        if (!current?.revision || data.bytes.byteLength > IMAGE_HISTORY_CHUNK_BYTES)
          throw new Error("Invalid image history chunk.");
        current.revision.update(data.bytes);
        break;
      case "end":
        if (!current) throw new Error("Invalid image history end.");
        response = {
          id: data.id,
          kind: "part",
          part: codexImageGenerationPart(
            current.image.item,
            current.image.context,
            current.revision?.digest(),
          ),
        };
        current = undefined;
        break;
    }
    self.postMessage(response);
  } catch (cause) {
    current = undefined;
    self.postMessage({
      id: data.id,
      kind: "error",
      message:
        cause instanceof Error
          ? cause.message
          : "Image history preparation failed. Reload this session.",
    } satisfies ImageHistoryWorkerResponse);
  }
};
