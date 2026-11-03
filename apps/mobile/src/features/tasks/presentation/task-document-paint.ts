import type { ResolvedTaskCard } from "@openducktor/workflows";
import { splitTaskDescriptionFrontMatter } from "@openducktor/frontend-core/tasks/description/task-description-front-matter";
import type { Tone } from "@/ui/tones";

/** The description that read views show: a valid front matter block stays hidden. */
export const taskDescriptionForReading = (description: string): string => {
  const split = splitTaskDescriptionFrontMatter(description);
  return split.kind === "valid" ? split.body : description;
};

type VerdictPresentation = { id: string; title: string; label: string; tone: Tone };

/** Review facts follow the declared artifact order and verdict labels. */
export const taskReviewVerdicts = (task: ResolvedTaskCard): VerdictPresentation[] =>
  task.taskWorkflow.definition.artifacts.flatMap((artifact) => {
    if (artifact.kind !== "review") return [];
    const summary = task.artifactSummary[artifact.id];
    const verdictId = summary?.verdict;
    const verdict = artifact.verdicts.find(({ id }) => id === verdictId);
    const shortLabel = artifact.shortLabel ?? artifact.label;
    return [
      {
        id: artifact.id,
        title: `${shortLabel} verdict`,
        label: verdict ? `${shortLabel} ${verdict.label}` : (verdictId ?? "Not reviewed"),
        tone: verdict ? (verdict.passes ? "success" : "rejected") : "neutral",
      },
    ];
  });
