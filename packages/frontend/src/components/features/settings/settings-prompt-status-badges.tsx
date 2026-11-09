import type { ComponentProps, ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { PROMPT_STATUS_LABELS, type PromptStatus } from "./settings-prompt-layers";

const BADGE_VARIANTS = {
  appended: "success",
  overridden: "secondary",
  outdated: "warning",
  error: "danger",
  globalChanges: "outline",
} as const satisfies Record<keyof PromptStatus, ComponentProps<typeof Badge>["variant"]>;

/** The order of the badges. */
const BADGE_ORDER: readonly (keyof PromptStatus)[] = [
  "appended",
  "overridden",
  "outdated",
  "error",
  "globalChanges",
];

/** The states of a prompt that show a badge, in badge order. */
export const promptStatusMarks = (status: PromptStatus): (keyof PromptStatus)[] =>
  BADGE_ORDER.filter((key) => status[key]);

/** The status badges of one prompt. An unchanged prompt has none, so changed prompts stand out. */
export function PromptStatusBadges({
  id,
  status,
}: {
  id?: string;
  status: PromptStatus;
}): ReactElement | null {
  const marks = promptStatusMarks(status);
  if (marks.length === 0) return null;
  return (
    <span id={id} className="flex shrink-0 gap-1">
      {marks.map((mark) => (
        <Badge key={mark} variant={BADGE_VARIANTS[mark]}>
          {PROMPT_STATUS_LABELS[mark]}
        </Badge>
      ))}
    </span>
  );
}
