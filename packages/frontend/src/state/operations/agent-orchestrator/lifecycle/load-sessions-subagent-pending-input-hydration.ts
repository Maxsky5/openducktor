import type { AgentSessionRecord } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { forEachSessionMessage } from "../support/messages";
import {
  EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  type SubagentPendingApprovalsByExternalSessionId,
  type SubagentPendingQuestionsByExternalSessionId,
} from "../support/subagent-approval-overlay";
import { isSubagentMessage } from "../support/subagent-messages";
import type { HydrationRuntimePlanner } from "./load-sessions-stages";

export type HydratedSubagentPendingInputOverlay = {
  scannedChildExternalSessionIds: string[];
  pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId;
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId;
  hydrationError: SubagentPendingInputHydrationError | null;
};

export class SubagentPendingInputHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentPendingInputHydrationError";
  }
}

export const EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY = Object.freeze({
  scannedChildExternalSessionIds: [],
  pendingApprovalsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_APPROVALS_BY_EXTERNAL_SESSION_ID,
  pendingQuestionsByChildExternalSessionId: EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID,
  hydrationError: null,
}) satisfies HydratedSubagentPendingInputOverlay;

const readSubagentSessionIds = (
  externalSessionId: string,
  messages: AgentSessionState["messages"],
): string[] => {
  const externalSessionIds = new Set<string>();
  forEachSessionMessage({ externalSessionId, messages }, (message) => {
    if (!isSubagentMessage(message)) {
      return;
    }
    const subagentSessionId = message.meta.externalSessionId?.trim();
    if (subagentSessionId) {
      externalSessionIds.add(subagentSessionId);
    }
  });
  return Array.from(externalSessionIds);
};

export const loadHydratedSubagentPendingInputOverlay = async ({
  record,
  messages,
  runtimePlanner,
}: {
  record: AgentSessionRecord;
  messages: AgentSessionState["messages"];
  runtimePlanner: HydrationRuntimePlanner;
}): Promise<HydratedSubagentPendingInputOverlay> => {
  const childExternalSessionIds = readSubagentSessionIds(record.externalSessionId, messages);
  if (childExternalSessionIds.length === 0) {
    return EMPTY_HYDRATED_SUBAGENT_PENDING_INPUT_OVERLAY;
  }

  const results = await Promise.allSettled(
    childExternalSessionIds.map(async (childExternalSessionId) => {
      try {
        return {
          childExternalSessionId,
          snapshot: await runtimePlanner.readSessionPresence({
            ...record,
            externalSessionId: childExternalSessionId,
          }),
        };
      } catch (error) {
        throw new Error(`subagent session '${childExternalSessionId}': ${errorMessage(error)}`);
      }
    }),
  );
  const pendingApprovalsByChildExternalSessionId: SubagentPendingApprovalsByExternalSessionId = {};
  const pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId = {};
  const scannedChildExternalSessionIds: string[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      failures.push(errorMessage(result.reason));
      continue;
    }
    const { childExternalSessionId, snapshot } = result.value;
    scannedChildExternalSessionIds.push(childExternalSessionId);
    if (snapshot.presence === "runtime" && snapshot.pendingApprovals.length > 0) {
      pendingApprovalsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingApprovals;
    }
    if (snapshot.presence === "runtime" && snapshot.pendingQuestions.length > 0) {
      pendingQuestionsByChildExternalSessionId[childExternalSessionId] = snapshot.pendingQuestions;
    }
  }
  const hydrationError =
    failures.length > 0
      ? new SubagentPendingInputHydrationError(
          `Failed to hydrate subagent pending input: ${failures.join("; ")}`,
        )
      : null;

  return {
    scannedChildExternalSessionIds,
    pendingApprovalsByChildExternalSessionId,
    pendingQuestionsByChildExternalSessionId,
    hydrationError,
  };
};
