import type { RuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import type { AgentSessionTranscriptState } from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@openducktor/frontend-core/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@openducktor/frontend-core/types/selected-session-runtime-data";

export type AgentStudioSelectedSessionState = {
  identity: AgentSessionIdentity | null;
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  runtimeData: SelectedSessionRuntimeData;
  runtimeReadiness: RuntimeReadiness;
  transcriptState: AgentSessionTranscriptState;
  sessionAuxiliaryError: string | null;
  preparation: { ready: boolean; error: string | null };
};
