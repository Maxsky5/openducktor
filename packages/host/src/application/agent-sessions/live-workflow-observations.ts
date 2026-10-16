import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  SessionOperationObservation,
  SubmissionAcknowledgement,
  TaskCompletionObservation,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";

type OperationEnvelope = Extract<
  AgentSessionLiveEnvelope,
  { type: "session_operation_updated" | "submission_acknowledged" | "task_completion_updated" }
>;

/** Retained observations use the live owner's publication coordinator. */
export const createLiveWorkflowObservations = () => {
  const launches = new Map<string, NonNullable<AgentSessionLiveSnapshot["launchFailure"]>>();
  const approvals = new Map<
    string,
    NonNullable<AgentSessionLiveSnapshot["approvalPolicyFailure"]>
  >();
  const operations = new Map<string, SessionOperationObservation>();
  const acknowledgements = new Map<string, SubmissionAcknowledgement>();
  const completions = new Map<string, TaskCompletionObservation>();
  return {
    accept: (envelope: OperationEnvelope) => {
      if (envelope.type === "session_operation_updated") {
        const observation = envelope.observation;
        const key = `${agentSessionRefKey(observation.ref)}\u0000${observation.kind}\u0000${observation.submissionId ?? ""}`;
        if (
          !observation.pending &&
          !observation.failure &&
          observation.nativeOutcome !== "uncertain"
        )
          operations.delete(key);
        else operations.set(key, structuredClone(observation));
      } else if (envelope.type === "submission_acknowledged") {
        const ack = envelope.acknowledgement;
        acknowledgements.set(
          `${agentSessionRefKey(ack.ref)}\u0000${ack.submissionId}`,
          structuredClone(ack),
        );
      } else {
        const observation = envelope.observation;
        const key = `${observation.repoPath}\u0000${observation.taskId}`;
        if (
          observation.phase === "settled" &&
          !observation.failure &&
          observation.uncertainDestinations.length === 0 &&
          ((observation.cleanupCompleted && observation.taskClosed) ||
            (!observation.cleanupCompleted &&
              !observation.taskClosed &&
              observation.confirmedDestinations.length === 0))
        )
          completions.delete(key);
        else completions.set(key, structuredClone(observation));
      }
    },
    snapshot: (repoPath: string) => ({
      sessionOperations: [...operations.values()].filter(
        (value) => value.ref.repoPath === repoPath,
      ),
      submissionAcknowledgements: [...acknowledgements.values()].filter(
        (value) => value.ref.repoPath === repoPath,
      ),
      taskCompletions: [...completions.values()].filter((value) => value.repoPath === repoPath),
    }),
    project: (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot => {
      const result = { ...snapshot };
      const key = agentSessionRefKey(snapshot.ref);
      const launch = launches.get(key);
      const approval = approvals.get(key);
      if (launch) result.launchFailure = launch;
      if (approval) result.approvalPolicyFailure = approval;
      return result;
    },
    approvalFailure: (ref: AgentSessionLiveRef, message: string | null, timestamp: string) => {
      if (message === null) approvals.delete(agentSessionRefKey(ref));
      else
        approvals.set(agentSessionRefKey(ref), {
          messageId: `approval-policy:${crypto.randomUUID()}`,
          message,
          timestamp,
        });
    },
    launchFailure: (
      ref: AgentSessionLiveRef,
      failure: NonNullable<AgentSessionLiveSnapshot["launchFailure"]>,
    ) => launches.set(agentSessionRefKey(ref), failure),
    clearLaunchFailure: (ref: AgentSessionLiveRef) => launches.delete(agentSessionRefKey(ref)),
  };
};
