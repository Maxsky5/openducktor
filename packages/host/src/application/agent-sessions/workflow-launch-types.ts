import type { SessionLaunchContext, SessionLaunchService } from "./session-launch-types";
import type {
  WorkflowLaunchRequest,
  WorkflowLaunchSnapshot,
  WorkflowLaunchRef,
  WorkflowLaunchRead,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import type { EventPublishingTaskService } from "../tasks/event-publishing-task-service";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskSessionOperations } from "./task-session-operations";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { WorkflowLaunchPreparationDependencies } from "./workflow-launch-preparation";
export type WorkflowLaunchContext = SessionLaunchContext<
  WorkflowLaunchRequest,
  WorkflowLaunchSnapshot
>;

export type WorkflowLaunchDependencies = WorkflowLaunchPreparationDependencies & {
  sessions: TaskSessionOperations;
  runtime: SessionLaunchRuntimePort &
    Pick<AgentSessionLiveStateService, "resumeSession" | "publishTaskSessionRecords">;
  tasks: EventPublishingTaskService;
  lifecycle: TaskSessionLifecycleCoordinator;
  withProcessStartAdmission: WithProcessStartAdmission;
  publish: (snapshot: WorkflowLaunchSnapshot) => Effect.Effect<void, HostError>;
};

export type WorkflowLaunchService = SessionLaunchService<
  WorkflowLaunchRequest,
  WorkflowLaunchSnapshot,
  WorkflowLaunchRef,
  WorkflowLaunchRead
>;
