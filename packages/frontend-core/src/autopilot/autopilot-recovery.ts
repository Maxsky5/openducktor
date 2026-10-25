import type {
  AgentSessionUserMessagePart,
  AutopilotOutcome,
  AutopilotRecoveryClaimInput,
  AutopilotRecoveryClaimResult,
} from "@openducktor/contracts";
import { toAgentSessionIdentity } from "../lib/agent-session-identity";
import { errorMessage } from "../lib/errors";
import type { AgentMessageSendReceipt, AgentSessionIdentity } from "../types/agent-orchestrator";

export const AUTOPILOT_MESSAGE_UNKNOWN_DESCRIPTION =
  "The host may have the message. Open the session and check the transcript before you send it again.";

export type AutopilotFailedOutcome = Extract<AutopilotOutcome, { kind: "failed" }>;

export type AutopilotRecoveryPorts = {
  claimRecovery: (input: AutopilotRecoveryClaimInput) => Promise<AutopilotRecoveryClaimResult>;
  /** Sends the unsent first instruction through the normal session send path. */
  sendMessage: (
    session: AgentSessionIdentity,
    instruction: AgentSessionUserMessagePart[],
  ) => Promise<AgentMessageSendReceipt | null>;
  /** The session send path works only in the selected workspace. */
  isWorkspaceSelected: (workspaceId: string) => boolean;
};

/** The first-message recovery of one failed launch. It outlives each view that shows it. */
export type AutopilotRecovery = {
  outcome: AutopilotFailedOutcome;
  session: AgentSessionIdentity;
  instruction: AgentSessionUserMessagePart[];
  /** The text that the next view of this recovery shows. */
  message: string;
  /** This client holds the host claim, so it can send again without a new claim. */
  claimed: boolean;
  /** A claim or send runs now. */
  pending: boolean;
  /** The instruction reached the session, or another client owns the recovery. */
  done: boolean;
};

/**
 * The result of one retry:
 * - `ignored`: a claim or send runs, or the recovery ended. Nothing ran.
 * - `workspace_not_selected`: the user must select the workspace first. `message` names the step.
 * - `not_claimed`: a retry already ran, or a later Autopilot action replaced the message.
 * - `sent`: the instruction reached the session.
 * - `unknown`: the connection lost the send result. The host may have the instruction, so the
 *   recovery ends without another send. `message` has the guidance.
 * - `failed`: the claim or send failed. `message` has the cause, and the user can retry.
 */
export type AutopilotRecoveryRetryResult =
  | "ignored"
  | "workspace_not_selected"
  | "not_claimed"
  | "sent"
  | "unknown"
  | "failed";

/** The recovery of a failed launch, or null when the launch has no unsent first message. */
export const createAutopilotRecovery = (
  outcome: AutopilotFailedOutcome,
): AutopilotRecovery | null => {
  const { launch } = outcome;
  if (!launch?.session || !launch.unsentInstruction) return null;
  return {
    outcome,
    session: toAgentSessionIdentity(launch.session),
    instruction: launch.unsentInstruction,
    message: outcome.message,
    claimed: false,
    pending: false,
    done: false,
  };
};

/** Claims the recovery on the host once, then sends the unsent first message again. */
export const retryAutopilotRecovery = async (
  recovery: AutopilotRecovery,
  ports: AutopilotRecoveryPorts,
): Promise<AutopilotRecoveryRetryResult> => {
  if (recovery.pending || recovery.done) return "ignored";
  const { outcome } = recovery;
  // Each attempt sends, and the send path works only in the selected workspace.
  if (!ports.isWorkspaceSelected(outcome.workspaceId)) {
    recovery.message = `Select the workspace of ${outcome.task.id}, then retry the message.`;
    return "workspace_not_selected";
  }
  recovery.pending = true;
  try {
    // Only one client can send the instruction again.
    if (!recovery.claimed) {
      const claim = await ports.claimRecovery({
        workspaceId: outcome.workspaceId,
        outcomeId: outcome.outcomeId,
      });
      if (!claim.claimed) {
        recovery.done = true;
        return "not_claimed";
      }
      recovery.claimed = true;
    }
    const receipt = await ports.sendMessage(recovery.session, recovery.instruction);
    recovery.done = true;
    if (receipt?.outcome === "uncertain") {
      recovery.message = AUTOPILOT_MESSAGE_UNKNOWN_DESCRIPTION;
      return "unknown";
    }
    return "sent";
  } catch (cause) {
    recovery.message = errorMessage(cause);
    return "failed";
  } finally {
    recovery.pending = false;
  }
};
