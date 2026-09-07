import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type {
  AgentImageGenerationPart,
  CodexAppServerThreadItem,
  CodexAppServerTurn,
} from "@openducktor/contracts";

export type CodexImageGenerationItem = Extract<
  CodexAppServerThreadItem,
  { type: "imageGeneration" }
>;
export type CodexImageGenerationContext = {
  liveStart?: boolean;
  turnId?: string;
  turnStatus?: CodexAppServerTurn["status"];
};

export const codexImageGenerationPart = (
  item: CodexImageGenerationItem,
  context: CodexImageGenerationContext = {},
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
    if (item.savedPath !== undefined || item.result.length > 0) {
      part.output = {
        revision: bytesToHex(
          sha256
            .create()
            .update(utf8ToBytes(item.savedPath !== undefined ? "saved_file\0" : "inline\0"))
            .update(utf8ToBytes(item.savedPath ?? item.result))
            .digest(),
        ),
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
  if (item.status !== "in_progress" && item.status !== "") {
    part.incompleteReason = "unknown_status";
    return part;
  }
  if (context.turnStatus === "interrupted") {
    part.status = "interrupted";
  } else if (context.liveStart || context.turnStatus === "inProgress") {
    part.status = "running";
  } else {
    part.incompleteReason =
      context.turnStatus === "failed" ? "runtime_failure" : "incomplete_history";
  }
  return part;
};
