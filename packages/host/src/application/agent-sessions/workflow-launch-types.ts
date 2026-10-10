import type { SessionLaunchService } from "./session-launch-types";
import type { WorkflowLaunchRequest, WorkflowLaunchResult } from "@openducktor/contracts";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskSessionOperations } from "./task-session-operations";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { WorkflowLaunchPreparationDependencies } from "./workflow-launch-preparation";

export type WorkflowLaunchDependencies = WorkflowLaunchPreparationDependencies & {
  sessions: Pick<TaskSessionOperations, "start" | "fork" | "resume">;
  /** `sendUserMessage` must apply the normal workflow send policy. */
  runtime: SessionLaunchRuntimePort &
    Pick<AgentSessionLiveStateService, "publishTaskSessionRecords">;
};

export type WorkflowLaunchService = SessionLaunchService<
  WorkflowLaunchRequest,
  WorkflowLaunchResult
>;
