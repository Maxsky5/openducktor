import { Rows2, Rows3 } from "lucide-react";

export const TASK_CARD_VIEW_OPTIONS = [
  { value: "normal", label: "Normal", icon: Rows2 },
  { value: "compact", label: "Compact", icon: Rows3 },
] as const;
