import type { AgentImageGenerationPart } from "@openducktor/contracts";

/** History can refresh an unchanged item, but cannot replace a result received during the read. */
export const mergeAgentImageGeneration = (
  current: AgentImageGenerationPart,
  incoming: AgentImageGenerationPart,
  source: "live" | "history",
  currentAtReadStart?: AgentImageGenerationPart,
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
  // Image parts are immutable. The same object means no update arrived during the read.
  if (source === "history" && isNativeTerminal(current) && current !== currentAtReadStart) {
    if (current.status !== incoming.status) return current;
    const merged = { ...incoming, ...current };
    if (current.previewUnavailableReason) delete merged.output;
    if (current.output) delete merged.previewUnavailableReason;
    if (current.output && current.output.revision !== incoming.output?.revision) {
      if (current.savedPath === undefined) delete merged.savedPath;
    }
    return merged;
  }
  const { output, failure, incompleteReason, previewUnavailableReason, ...metadata } = current;
  const merged = { ...metadata, ...incoming };
  if (current.status === incoming.status) {
    if (
      source === "live" &&
      incoming.output === undefined &&
      output !== undefined &&
      !incoming.previewUnavailableReason
    )
      merged.output = output;
    if (
      source === "live" &&
      !incoming.output &&
      !incoming.previewUnavailableReason &&
      previewUnavailableReason
    )
      merged.previewUnavailableReason = previewUnavailableReason;
    if (incoming.failure === undefined && failure !== undefined) merged.failure = failure;
    if (incoming.incompleteReason === undefined && incompleteReason !== undefined)
      merged.incompleteReason = incompleteReason;
  }
  if (
    (source === "history" ||
      (incoming.output && incoming.output.revision !== current.output?.revision)) &&
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
