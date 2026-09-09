import { CODEX_RUNTIME_DESCRIPTOR, DEFAULT_CODEX_RUNTIME_POLICY } from "@openducktor/contracts";
import type { CodexAppServerJsonValue, RuntimeInstanceSummary } from "@openducktor/contracts";
import type { PolicyBoundSessionRef, StartAgentSessionInput } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";

export const imageSessionRef = (
  runtimeId: string,
): Extract<PolicyBoundSessionRef, { runtimeKind: "codex" }> => ({
  repoPath: "/repo",
  workingDirectory: "/repo",
  runtimeKind: "codex",
  externalSessionId: `thread-${runtimeId}`,
  sessionScope: workflowAgentSessionScope("task-1", "build"),
  runtimePolicy: {
    kind: "codex",
    policy: { ...DEFAULT_CODEX_RUNTIME_POLICY, approvalsReviewerApplies: true },
  },
});
export const imageSessionInput = (runtimeId: string): StartAgentSessionInput => ({
  ...imageSessionRef(runtimeId),
  sessionScope: workflowAgentSessionScope("task-1", "build"),
  systemPrompt: "Use the repo rules.",
  model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
});
export const imageRuntime = (runtimeId: string): RuntimeInstanceSummary => ({
  kind: "codex",
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "stdio", identity: runtimeId },
  startedAt: "2026-09-06T10:00:00.000Z",
  descriptor: CODEX_RUNTIME_DESCRIPTOR,
});
export const nativeImage = (id: string, status = "in_progress") => ({
  type: "imageGeneration",
  id,
  status,
  result: "",
  revisedPrompt: "A duck",
  transparentBackground: null,
  failure: null,
});
export const nativeImageTurn = (
  id: string,
  status = "inProgress",
  items: CodexAppServerJsonValue[] = [],
) => ({
  id,
  status,
  items,
  itemsView: "full",
  startedAt: null,
  completedAt: null,
  durationMs: null,
  error:
    status === "failed"
      ? { message: "Turn failed", codexErrorInfo: null, additionalDetails: null }
      : null,
});
export const nativeImageThread = (id: string) => ({
  id,
  extra: null,
  sessionId: id,
  forkedFromId: null,
  parentThreadId: null,
  preview: "Image test session",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 1_778_112_000,
  updatedAt: 1_778_112_000,
  recencyAt: 1_778_112_000,
  status: { type: "active", activeFlags: [] },
  path: null,
  cwd: "/repo",
  cliVersion: "0.153.4-test",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns: [],
});
export const imageThreadStartResult = (threadId: string) => ({
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  activePermissionProfile: null,
  cwd: "/repo",
  instructionSources: [],
  model: "gpt-5",
  modelProvider: "openai",
  multiAgentMode: "explicitRequestOnly",
  reasoningEffort: "medium",
  runtimeWorkspaceRoots: ["/repo"],
  sandbox: {
    type: "workspaceWrite",
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    writableRoots: ["/repo"],
  },
  serviceTier: null,
  thread: nativeImageThread(threadId),
});
export const imageModelList = () => ({
  data: [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "Test model",
      hidden: false,
      additionalSpeedTiers: [],
      availabilityNux: null,
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
      defaultReasoningEffort: "medium",
      defaultServiceTier: null,
      inputModalities: ["text"],
      modelSpecialty: null,
      multiAgentVersion: null,
      serviceTiers: [],
      supportsPersonality: true,
      isDefault: true,
      upgrade: null,
      upgradeInfo: null,
    },
  ],
  nextCursor: null,
});
