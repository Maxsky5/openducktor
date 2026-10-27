import { splitTaskDescriptionFrontMatter } from "@openducktor/frontend-core/tasks/description/task-description-front-matter";
import type { Tone } from "@/ui/tones";

/** The description that read views show: a valid front matter block stays hidden. */
export const taskDescriptionForReading = (description: string): string => {
  const split = splitTaskDescriptionFrontMatter(description);
  return split.kind === "valid" ? split.body : description;
};

type VerdictPresentation = { label: string; tone: Tone };

const NOT_REVIEWED: VerdictPresentation = { label: "Not reviewed", tone: "neutral" };

const QA_VERDICTS = new Map<string, VerdictPresentation>([
  ["approved", { label: "QA approved", tone: "success" }],
  ["rejected", { label: "QA rejected", tone: "rejected" }],
]);

/** The QA verdict of a task. A task without a QA verdict is not reviewed. */
export const qaVerdictPresentation = (verdict: string | undefined): VerdictPresentation =>
  (verdict === undefined ? undefined : QA_VERDICTS.get(verdict)) ?? NOT_REVIEWED;
