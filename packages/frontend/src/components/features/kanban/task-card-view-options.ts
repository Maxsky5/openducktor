import type { KanbanTaskCardView } from "@openducktor/contracts";
import { type LucideIcon, Rows2, Rows3 } from "lucide-react";

export const TASK_CARD_VIEW_ICONS = {
  normal: Rows2,
  compact: Rows3,
} satisfies Record<KanbanTaskCardView, LucideIcon>;
