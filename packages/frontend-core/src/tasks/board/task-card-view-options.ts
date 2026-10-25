import type { KanbanTaskCardView } from "@openducktor/contracts";

export const TASK_CARD_VIEW_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compact" },
] as const satisfies readonly { value: KanbanTaskCardView; label: string }[];
