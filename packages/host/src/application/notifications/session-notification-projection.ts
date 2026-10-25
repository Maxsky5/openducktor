import type {
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveSnapshot,
  AgentSessionScope,
  NotificationOccurrence,
} from "@openducktor/contracts";
import { pendingInputIdentity } from "./pending-input-identity";

export type Projection = {
  association: AgentSessionScope | null;
  snapshot: AgentSessionLiveSnapshot;
  executionEpisodeId: string | undefined;
  errorNotified: boolean;
  idleNotified: boolean;
  lastAssistantMessage: { id: string; text: string } | null;
  pendingApprovals: Set<string>;
  pendingQuestions: Set<string>;
  running: boolean;
  unownedInputs: UnownedInputs | null;
  unownedTerminals: Map<string, NotificationOccurrence>;
  childQuestions: Map<string, AgentSessionLivePendingQuestionRequest>;
};

type UnownedInputs = {
  approvals: Set<string>;
  questions: Set<string>;
  liveApprovals: Set<string>;
  liveQuestions: Set<string>;
};

export const createProjection = (
  snapshot: AgentSessionLiveSnapshot,
  association: AgentSessionScope | null,
): Projection => ({
  association,
  snapshot,
  executionEpisodeId: snapshot.executionEpisodeId,
  errorNotified: false,
  idleNotified: false,
  lastAssistantMessage: null,
  pendingApprovals: new Set(snapshot.pendingApprovals.map(pendingInputIdentity)),
  pendingQuestions: new Set(snapshot.pendingQuestions.map(pendingInputIdentity)),
  running: snapshot.activity !== "idle",
  unownedInputs: null,
  unownedTerminals: new Map(),
  childQuestions: new Map(),
});

export const clearDeferred = (projection: Projection): void => {
  projection.unownedInputs = null;
  projection.unownedTerminals.clear();
  projection.childQuestions.clear();
};

export const requireEpisodeId = (projection: Projection): string => {
  if (!projection.executionEpisodeId) {
    throw new Error("The live Agent Session has no execution episode ID. Reload to reconnect.");
  }
  return projection.executionEpisodeId;
};
