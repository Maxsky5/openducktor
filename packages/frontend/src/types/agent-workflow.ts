import type {
  WorkflowStepPresentation,
  WorkflowStepRailState,
} from "@openducktor/frontend-core/types/agent-workflow";
import type { LucideIcon } from "lucide-react";

export type WorkflowRailStep = WorkflowStepRailState & {
  id: string;
  label: string;
  icon: LucideIcon;
  state: WorkflowStepPresentation;
};
