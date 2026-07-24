import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
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

type ProjectOverrides = Partial<ProjectionInput>;

const project = (overrides: ProjectOverrides = {}) => {
  const projectionOverrides = overrides;
  const selectedSessionIdentity = projectionOverrides.selectedSessionIdentity ?? null;
  const selectedTask = projectionOverrides.selectedTask ?? null;

  return deriveSelectedSessionViewProjection({
    session: null,
    sessionSummary: null,
    readModelLoadState,
    repoReadinessState: "ready",
    ...projectionOverrides,
    selectedSessionIdentity,
    selectedTask,
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
    expect(projection.transcriptState).toEqual({ kind: "visible" });
  });

  test("ignores a loaded session that does not match the selected identity", () => {
    const selectedSummary = createAgentSessionSummaryFixture({
      externalSessionId: "selected-planner-session",
      runtimeKind: "claude",
      status: "running",
      selectedModel: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "sonnet",
        variant: "high",
        profileId: "planner",
      },
    });
    const staleLoadedSession = createAgentSessionFixture({
      externalSessionId: "stale-spec-session",
      runtimeKind: "claude",
      status: "idle",
      messages: createSessionMessagesState("stale-spec-session", [
        {
          id: "stale-ok",
          role: "assistant",
          content: "OK",
          timestamp: "2026-06-28T19:55:51.000Z",
          meta: { kind: "assistant", isFinal: true },
        },
      ]),
      selectedModel: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "sonnet",
        variant: "high",
        profileId: "spec",
      },
    });

    const projection = project({
      selectedSessionIdentity: toAgentSessionIdentity(selectedSummary),
      session: staleLoadedSession,
      sessionSummary: selectedSummary,
      selectedTask: createTaskCardFixture(),
    });

    expect(projection.activityState).toBe("running");
    expect(projection.selectedModel).toBe(selectedSummary.selectedModel);
    expect(projection.transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
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
    expect(projection.transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("uses repository settings as the runtime target for sessionless selected tasks", () => {
    const selectedTask = createTaskCardFixture();
    const runtimeTarget = deriveSelectedSessionRuntimeTarget({
      selectedSessionIdentity: null,
      selectedTask,
      role: "build",
      repoSettings,
      isLoadingRepoSettings: false,
    });
    const selectedTaskProjection = project({
      selectedTask,
    });

    expect(runtimeTarget).toEqual({
      kind: "runtime",
      runtimeKind: "codex",
    });
    expect(selectedTaskProjection.activityState).toBeNull();
    expect(selectedTaskProjection.selectedModel).toBeNull();
  });

  test("uses selected session runtime as the runtime target", () => {
    const summary = createAgentSessionSummaryFixture({
      externalSessionId: "session-4",
      runtimeKind: "opencode",
    });

    expect(
      deriveSelectedSessionRuntimeTarget({
        selectedSessionIdentity: toAgentSessionIdentity(summary),
        selectedTask: createTaskCardFixture(),
        role: "build",
        repoSettings,
        isLoadingRepoSettings: false,
      }),
    ).toEqual({
      kind: "runtime",
      runtimeKind: "opencode",
    });
  });

  test("keeps sessionless selected tasks resolving while repository settings load", () => {
    expect(
      deriveSelectedSessionRuntimeTarget({
        selectedSessionIdentity: null,
        selectedTask: createTaskCardFixture(),
        role: "build",
        repoSettings: null,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "resolving" });
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
