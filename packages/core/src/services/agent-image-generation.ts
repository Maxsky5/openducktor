import type { AgentImageGenerationPart } from "@openducktor/contracts";

/** Merge one session's image item without letting old history replace a runtime result. */
export const mergeAgentImageGeneration = (
  current: AgentImageGenerationPart,
  incoming: AgentImageGenerationPart,
  source: "live" | "history",
): AgentImageGenerationPart => {
  if (
    current.itemId !== incoming.itemId ||
    (current.turnId !== undefined &&
      incoming.turnId !== undefined &&
      current.turnId !== incoming.turnId)
  ) {
    throw new Error("Cannot merge image generation items with different identity.");
  }
  if (
    (isNativeTerminal(current) || current.status === "interrupted") &&
    !isNativeTerminal(incoming)
  )
    return current;
  if (current.status !== "running" && incoming.status === "running") return current;
  if (source === "history" && isNativeTerminal(current)) {
    if (current.status !== incoming.status) return current;
    const merged = { ...incoming, ...current };
    if (current.output && current.output.revision !== incoming.output?.revision) {
      if (current.savedPath === undefined) delete merged.savedPath;
    }
    return merged;
  }
  const { output, failure, incompleteReason, ...metadata } = current;
  const merged = { ...metadata, ...incoming };
  if (current.status === incoming.status) {
    if (incoming.output === undefined && output !== undefined) merged.output = output;
    if (incoming.failure === undefined && failure !== undefined) merged.failure = failure;
    if (incoming.incompleteReason === undefined && incompleteReason !== undefined)
      merged.incompleteReason = incompleteReason;
  }
  if (
    incoming.output &&
    incoming.output.revision !== current.output?.revision &&
    incoming.savedPath === undefined
  )
    delete merged.savedPath;
  return merged;
};

export type AgentImageGenerationSettlement = "interrupted" | "turn_ended" | "runtime_failure";

export const settleAgentImageGeneration = (
  part: AgentImageGenerationPart,
  reason: AgentImageGenerationSettlement,
): AgentImageGenerationPart => {
  if (
    part.status !== "running" &&
    !(
      part.status === "incomplete" &&
      (reason === "interrupted" ||
        (part.incompleteReason === "turn_ended" && reason === "runtime_failure"))
    )
  )
    return part;
  if (reason !== "interrupted") return { ...part, status: "incomplete", incompleteReason: reason };
  const { incompleteReason: _incompleteReason, ...metadata } = part;
  return { ...metadata, status: "interrupted" };
};

const isNativeTerminal = (part: AgentImageGenerationPart): boolean =>
  part.status === "completed" || part.status === "failed";
