import type { PlanSubtaskInput } from "./contracts";
import { normalizeIssueType } from "./task-mapping";

export const normalizePlanSubtasks = (inputs: PlanSubtaskInput[]): PlanSubtaskInput[] => {
  const normalized: PlanSubtaskInput[] = [];

  for (const input of inputs) {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error("Subtask proposals require a non-empty title.");
    }

    const issueType = normalizeIssueType(input.issueType);
    if (issueType === "epic") {
      throw new Error("Epic subtasks are not allowed.");
    }

    const priority = Math.max(0, Math.min(4, input.priority ?? 2));
    const description = input.description?.trim();

    normalized.push({
      title,
      issueType,
      priority,
      ...(description ? { description } : {}),
    });
  }

  return normalized;
};
