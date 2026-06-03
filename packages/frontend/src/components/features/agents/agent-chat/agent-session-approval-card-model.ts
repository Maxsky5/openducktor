import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";

export const resolveApprovalReplyOutcomes = ({
  requestSupportedReplyOutcomes,
  runtimeSupportedReplyOutcomes,
}: {
  requestSupportedReplyOutcomes?: readonly RuntimeApprovalReplyOutcome[] | undefined;
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
}): RuntimeApprovalReplyOutcome[] => {
  if (!runtimeSupportedReplyOutcomes) {
    return [];
  }

  const requestOutcomes = requestSupportedReplyOutcomes ?? runtimeSupportedReplyOutcomes;
  const runtimeOutcomeSet = new Set(runtimeSupportedReplyOutcomes);
  const effectiveOutcomeSet = new Set<RuntimeApprovalReplyOutcome>();
  const effectiveOutcomes: RuntimeApprovalReplyOutcome[] = [];
  for (const outcome of requestOutcomes) {
    if (!runtimeOutcomeSet.has(outcome) || effectiveOutcomeSet.has(outcome)) {
      continue;
    }
    effectiveOutcomeSet.add(outcome);
    effectiveOutcomes.push(outcome);
  }
  return effectiveOutcomes;
};
