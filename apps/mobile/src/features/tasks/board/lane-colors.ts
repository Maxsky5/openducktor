import type { WorkflowTone } from "@openducktor/contracts";
import type { AppTheme } from "@/theme/tokens";

export const laneColors = (theme: AppTheme, tone: WorkflowTone) => theme.lanes[tone];
