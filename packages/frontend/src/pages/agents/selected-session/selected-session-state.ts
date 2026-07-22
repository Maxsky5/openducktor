import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";

export type AgentStudioSelectedSessionState = {
  identity: AgentSessionIdentity | null;
  activityState: AgentSessionActivityState | null;
  selectedModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  runtimeData: SelectedSessionRuntimeData;
  runtimeReadiness: RepoRuntimeReadiness;
  transcriptState: AgentSessionTranscriptState;
  sessionAuxiliaryError: string | null;
};
