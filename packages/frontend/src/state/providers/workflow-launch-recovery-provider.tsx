import type { PropsWithChildren, ReactElement } from "react";
import { useWorkflowLaunchRecovery } from "@/features/session-start/use-workflow-launch-recovery";

export function WorkflowLaunchRecoveryProvider({ children }: PropsWithChildren): ReactElement {
  useWorkflowLaunchRecovery();
  return <>{children}</>;
}
