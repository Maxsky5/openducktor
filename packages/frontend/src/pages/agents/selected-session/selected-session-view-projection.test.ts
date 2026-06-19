import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createAgentSessionSummaryFixture,
  createTaskCardFixture,
} from "../agent-studio-test-utils";
import {
  deriveSelectedSessionRuntimeTarget,
  deriveSelectedSessionViewProjection,
} from "./selected-session-view-projection";

const repoPath = "/repo";
const readModelLoadState = readyAgentSessionReadModelLoadState(repoPath);
const repoSettings = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    },
    qa: null,
  },
} satisfies RepoSettingsInput;

type ProjectionInput = Parameters<typeof deriveSelectedSessionViewProjection>[0];
type RuntimeTargetInput = Parameters<typeof deriveSelectedSessionRuntimeTarget>[0];

type ProjectOverrides = Partial<ProjectionInput> &
  Partial<Pick<RuntimeTargetInput, "role" | "repoSettings" | "isLoadingRepoSettings">>;

const project = (overrides: ProjectOverrides = {}) => {
  const {
    role = "build",
    repoSettings: runtimeRepoSettings = repoSettings,
    isLoadingRepoSettings = false,
    ...projectionOverrides
  } = overrides;
  const selectedSessionIdentity = projectionOverrides.selectedSessionIdentity ?? null;
  const selectedTask = projectionOverrides.selectedTask ?? null;
  const runtimeTarget =
    projectionOverrides.runtimeTarget ??
    deriveSelectedSessionRuntimeTarget({
      selectedSessionIdentity,
      selectedTask,
      role,
      repoSettings: runtimeRepoSettings,
      isLoadingRepoSettings,
    });

  return deriveSelectedSessionViewProjection({
    session: null,
    sessionSummary: null,
    readModelLoadState,
    repoReadinessState: "ready",
    ...projectionOverrides,
    selectedSessionIdentity,
    selectedTask,
    runtimeTarget,
  });
};

describe("selected-session-view-projection", () => {
  test("uses the loaded session as the selected-session projection when available", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      pendingQuestions: [],
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude",
        variant: "",
        profileId: "builder",
      },
    });
    const projection = project({
      selectedSessionIdentity: toAgentSessionIdentity(session),
      session,
      sessionSummary: createAgentSessionSummaryFixture({ externalSessionId: "session-1" }),
      selectedTask: createTaskCardFixture(),
    });

    expect(projection.activityState).toBe("running");
    expect(projection.selectedModel).toBe(session.selectedModel);
    expect(projection.runtimeTarget).toEqual({ kind: "runtime", runtimeKind: "opencode" });
    expect(projection.transcriptState).toEqual({ kind: "visible" });
  });

  test("uses the selected-session summary while the full session is not loaded", () => {
    const summary = createAgentSessionSummaryFixture({
      externalSessionId: "session-2",
      runtimeKind: "codex",
      status: "running",
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [],
        },
      ],
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "planner",
      },
    });
    const projection = project({
      selectedSessionIdentity: toAgentSessionIdentity(summary),
      session: null,
      sessionSummary: summary,
      selectedTask: createTaskCardFixture(),
    });

    expect(projection.activityState).toBe("waiting_input");
    expect(projection.selectedModel).toBe(summary.selectedModel);
    expect(projection.runtimeTarget).toEqual({ kind: "runtime", runtimeKind: "codex" });
    expect(projection.transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("uses repository settings as the runtime target for sessionless selected tasks", () => {
    const selectedTaskProjection = project({
      selectedTask: createTaskCardFixture(),
    });

    expect(selectedTaskProjection.activityState).toBeNull();
    expect(selectedTaskProjection.selectedModel).toBeNull();
    expect(selectedTaskProjection.runtimeTarget).toEqual({
      kind: "runtime",
      runtimeKind: "codex",
    });
  });

  test("keeps sessionless selected tasks resolving while repository settings load", () => {
    const selectedTaskProjection = project({
      selectedTask: createTaskCardFixture(),
      repoSettings: null,
      isLoadingRepoSettings: true,
    });

    expect(selectedTaskProjection.runtimeTarget).toEqual({ kind: "resolving" });
  });

  test("distinguishes sessionless selected tasks from inactive selections", () => {
    const selectedTaskProjection = project({
      selectedTask: createTaskCardFixture(),
    });
    const waitingSelectedTaskProjection = project({
      selectedTask: createTaskCardFixture(),
      repoReadinessState: "checking",
    });
    const inactiveProjection = project({ repoReadinessState: "checking" });

    expect(selectedTaskProjection.transcriptState).toEqual({
      kind: "empty",
      reason: "sessionless",
    });
    expect(waitingSelectedTaskProjection.transcriptState).toEqual({ kind: "runtime_waiting" });
    expect(inactiveProjection.runtimeTarget).toEqual({
      kind: "inactive",
    });
    expect(inactiveProjection.transcriptState).toEqual({ kind: "empty", reason: "inactive" });
  });

  test("waits for runtime readiness before resolving selected task read-model loading", () => {
    const projection = project({
      selectedTask: createTaskCardFixture(),
      readModelLoadState: loadingAgentSessionReadModelLoadState(repoPath),
      repoReadinessState: "checking",
    });
    const readyProjection = project({
      selectedTask: createTaskCardFixture(),
      readModelLoadState: loadingAgentSessionReadModelLoadState(repoPath),
      repoReadinessState: "ready",
    });

    expect(projection.transcriptState).toEqual({ kind: "runtime_waiting" });
    expect(readyProjection.transcriptState).toEqual({
      kind: "session_loading",
      reason: "preparing",
    });
  });

  test("surfaces selected session read-model failures", () => {
    const summary = createAgentSessionSummaryFixture({
      externalSessionId: "session-3",
      runtimeKind: "codex",
    });
    const projection = project({
      selectedSessionIdentity: toAgentSessionIdentity(summary),
      session: null,
      sessionSummary: summary,
      selectedTask: createTaskCardFixture(),
      readModelLoadState: failedAgentSessionReadModelLoadState(repoPath, "Session history failed"),
    });

    expect(projection.transcriptState).toEqual({
      kind: "failed",
      message: "Session history failed",
    });
  });
});
