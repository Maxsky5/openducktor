import type { QaWorkflowVerdict } from "@openducktor/contracts";
import { splitTaskDescriptionFrontMatter } from "@openducktor/frontend-core/tasks/description/task-description-front-matter";
import type { Tone } from "@/ui/tones";

/** The description that read views show: a valid front matter block stays hidden. */
export const taskDescriptionForReading = (description: string): string => {
  const split = splitTaskDescriptionFrontMatter(description);
  return split.kind === "valid" ? split.body : description;
};

const QA_VERDICTS = {
  approved: { label: "QA approved", tone: "success" },
  rejected: { label: "QA rejected", tone: "rejected" },
  not_reviewed: { label: "Not reviewed", tone: "neutral" },
} as const satisfies Record<QaWorkflowVerdict, { label: string; tone: Tone }>;

export const qaVerdictPresentation = (
  verdict: QaWorkflowVerdict,
): (typeof QA_VERDICTS)[QaWorkflowVerdict] => QA_VERDICTS[verdict];
