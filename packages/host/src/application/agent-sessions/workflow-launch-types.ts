import type { Effect } from "effect";
import type { SessionLaunchService } from "./session-launch-types";
import type { WorkflowLaunchRequest, WorkflowLaunchResult } from "@openducktor/contracts";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { TaskSessionOperations } from "./task-session-operations";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { WorkflowLaunchPreparationDependencies } from "./workflow-launch-preparation";
import type { AgentMessageDeliveryService } from "./agent-message-delivery-service";

export type WorkflowLaunchDependencies = WorkflowLaunchPreparationDependencies & {
  sessions: Pick<TaskSessionOperations, "start" | "fork" | "resume">;
  messageDelivery: Pick<AgentMessageDeliveryService, "submit">;
  /** `sendUserMessage` must apply the normal workflow send policy. */
  runtime: SessionLaunchRuntimePort &
    Pick<AgentSessionLiveStateService, "publishTaskSessionRecords" | "updateSessionModel">;
};

/** Decides, when a waiting automatic launch gets its turn, whether it still starts. */
export type AutomaticWorkflowLaunchStartCheck = Effect.Effect<
  { start: true } | { start: false; reason: string },
  HostError
>;

/**
 * Only the host creates an automatic launch, so clients cannot send one. The shared Autopilot
 * action decides how it starts. At its turn, the launch runs `startCheck` before any other work
 * and settles as skipped when the check declines.
 */
export type AutomaticWorkflowLaunchRequest = Omit<WorkflowLaunchRequest, "policy"> & {
  policy: {
    kind: "automatic";
    actionId: string;
    startCheck: AutomaticWorkflowLaunchStartCheck;
  };
};

export type WorkflowLaunchAttemptRequest = WorkflowLaunchRequest | AutomaticWorkflowLaunchRequest;

export type WorkflowLaunchService = SessionLaunchService<
  WorkflowLaunchAttemptRequest,
  WorkflowLaunchResult
>;
