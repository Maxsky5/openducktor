import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type {
  AgentImageGenerationPart,
  AgentSessionLiveRef,
  CodexAppServerThreadItem,
  CodexAppServerTurn,
} from "@openducktor/contracts";

export type CodexImageGenerationItem = Extract<
  CodexAppServerThreadItem,
  { type: "imageGeneration" }
>;
export type CodexImageGenerationContext = {
  ref?: AgentSessionLiveRef;
  liveStart?: boolean;
  turnId?: string;
  turnStatus?: CodexAppServerTurn["status"];
};

export const createCodexInlineImageRevision = () => {
  const hash = sha256.create().update(utf8ToBytes("inline\0"));
  return {
    update: (bytes: Uint8Array): void => {
      hash.update(bytes);
    },
    digest: (): string => bytesToHex(hash.digest()),
  };
};

const inlineImageRevision = (result: string): string => {
  const revision = createCodexInlineImageRevision();
  revision.update(utf8ToBytes(result));
  return revision.digest();
};

export const codexImageGenerationPart = (
  item: CodexImageGenerationItem,
  context: CodexImageGenerationContext = {},
  preparedRevision?: string,
): AgentImageGenerationPart => {
  const part: AgentImageGenerationPart = {
    kind: "image_generation",
    messageId: item.id,
    partId: item.id,
    itemId: item.id,
    status: "incomplete",
  };
  if (context.turnId !== undefined) part.turnId = context.turnId;
  if (item.revisedPrompt !== null) part.revisedPrompt = item.revisedPrompt;
  if (item.transparentBackground != null) part.transparentBackground = item.transparentBackground;
  if (item.savedPath !== undefined) part.savedPath = item.savedPath;
  if (item.status === "completed") {
    part.status = "completed";
    if (
      preparedRevision !== undefined ||
      (item.savedPath === undefined && item.result.length > 0)
    ) {
      part.output = {
        revision: preparedRevision ?? inlineImageRevision(item.result),
      };
    }
    return part;
  }
  if (item.status === "failed") {
    part.status = "failed";
    part.failure = {
      kind: "generation_failed",
      message:
        "Codex could not generate this image. It did not include a reason in the image result.",
    };
    if (item.failure?.type === "usageLimitExceeded") {
      part.failure = {
        kind: "usage_limit",
        message: "The runtime image generation usage limit was reached.",
      };
      if (item.failure.resetsAt !== null) part.failure.resetsAtEpochSeconds = item.failure.resetsAt;
    }
    return part;
  }
  if (context.turnStatus === "interrupted") {
    part.status = "interrupted";
  } else if (context.turnStatus === "failed" || context.turnStatus === "completed") {
    part.incompleteReason =
      context.turnStatus === "failed" ? "runtime_failure" : "incomplete_history";
  } else if (item.status !== "in_progress" && item.status !== "") {
    part.incompleteReason = "unknown_status";
  } else if (context.liveStart || context.turnStatus === "inProgress") {
    part.status = "running";
  } else {
    part.incompleteReason = "incomplete_history";
  }
  return part;
};

export type CodexImageGenerationPreparation = {
  item: CodexImageGenerationItem;
  context: CodexImageGenerationContext;
};

export type CodexImageGenerationPreparer = (
  images: readonly CodexImageGenerationPreparation[],
  signal?: AbortSignal,
  purpose?: "history" | "preview",
) => Promise<AgentImageGenerationPart[]>;
