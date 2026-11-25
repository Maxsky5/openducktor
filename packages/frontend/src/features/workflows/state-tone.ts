import type { WorkflowTone } from "@openducktor/contracts";
import { laneTheme } from "@/lib/task-status-presentation";

/**
 * The accent colour of a state tone, for a dot or a bar. The board shows no bar for a neutral
 * column, but a dot needs one.
 */
export const toneAccentClass = (tone: WorkflowTone): string =>
  tone === "neutral" ? "bg-muted-foreground/35" : laneTheme(tone).headerAccentClass;
