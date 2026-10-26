import type { AgentImageGenerationPart, AgentSessionLiveRef } from "@openducktor/contracts";

/** The status label of an image generation row. */
export const imageGenerationStatusLabel = (part: AgentImageGenerationPart): string => {
  switch (part.status) {
    case "running":
      return "Generating image…";
    case "completed":
      return "Image generated";
    case "failed":
      return part.failure?.kind === "usage_limit"
        ? "Image generation limit reached"
        : "Image generation failed";
    case "interrupted":
      return "Image generation interrupted";
    case "incomplete":
      return "Image generation outcome unknown";
  }
};

export const IMAGE_GENERATION_INTERRUPTED_TEXT =
  "The turn stopped before the runtime confirmed an image result.";
export const IMAGE_GENERATION_MISSING_SESSION_TEXT =
  "Preview unavailable: the session reference is missing. Reopen the session.";
export const IMAGE_GENERATION_UNSUPPORTED_TEXT = "This runtime does not support image previews.";

export const imageGenerationIncompleteText = (part: AgentImageGenerationPart): string =>
  part.incompleteReason === "runtime_failure"
    ? "The turn failed before the runtime confirmed an image result."
    : "The runtime did not confirm an image result. Check the session in the runtime.";

/** The failure reason and the next steps of a failed image generation. */
export type ImageGenerationFailureText = { message: string; nextSteps: string[] };

export const imageGenerationFailureText = (
  failure: AgentImageGenerationPart["failure"],
  formatResetTime: (epochSeconds: number) => string,
): ImageGenerationFailureText => {
  const resetSeconds = failure?.resetsAtEpochSeconds;
  const nextSteps: string[] = [];
  if (failure?.kind !== "usage_limit") {
    nextSteps.push("Ask the agent to explain this failure before trying again.");
  }
  if (resetSeconds !== undefined) {
    nextSteps.push(`Wait until ${formatResetTime(resetSeconds)} before requesting another image.`);
  }
  if (failure?.kind === "usage_limit" && resetSeconds === undefined) {
    nextSteps.push(
      "Check image-generation usage limits in the runtime before requesting another image.",
    );
  }
  return {
    message:
      failure?.message ||
      "The runtime could not generate this image. It did not provide a failure reason.",
    nextSteps,
  };
};

/** The read that shows a completed generated image. */
export type GeneratedImagePreviewPlan =
  | { kind: "unsupported"; message: string }
  | { kind: "unavailable"; message: string }
  /** The runtime saved the image file. Its metadata names the revision to read. */
  | { kind: "metadata"; ref: AgentSessionLiveRef; itemId: string; turnId?: string }
  | {
      kind: "revision";
      ref: AgentSessionLiveRef;
      itemId: string;
      turnId?: string;
      revision: string;
    };

export const resolveGeneratedImagePreviewPlan = (
  part: AgentImageGenerationPart,
  sessionRef: AgentSessionLiveRef,
  supportsImageGeneration: boolean,
): GeneratedImagePreviewPlan => {
  if (!supportsImageGeneration) {
    return { kind: "unsupported", message: IMAGE_GENERATION_UNSUPPORTED_TEXT };
  }
  if (!part.output && part.savedPath !== undefined && !part.previewUnavailableReason) {
    const plan: GeneratedImagePreviewPlan = {
      kind: "metadata",
      ref: sessionRef,
      itemId: part.itemId,
    };
    if (part.turnId !== undefined) plan.turnId = part.turnId;
    return plan;
  }
  if (!part.output) {
    return {
      kind: "unavailable",
      message:
        part.previewUnavailableReason ??
        "Preview unavailable: the runtime did not report image output. Check the session in the runtime.",
    };
  }
  const plan: GeneratedImagePreviewPlan = {
    kind: "revision",
    ref: sessionRef,
    itemId: part.itemId,
    revision: part.output.revision,
  };
  if (part.turnId !== undefined) plan.turnId = part.turnId;
  return plan;
};

export const GENERATED_IMAGE_DEFAULT_ALT = "Generated image";

export const generatedImageAlt = (part: AgentImageGenerationPart): string =>
  part.revisedPrompt || GENERATED_IMAGE_DEFAULT_ALT;
