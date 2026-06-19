import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { deriveAgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
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
import { deriveSelectedSessionViewProjection } from "./selected-session-view-source";

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

const project = (overrides: Partial<ProjectionInput> = {}) =>
  deriveSelectedSessionViewProjection({
    selectedSessionIdentity: null,
    session: null,
    sessionSummary: null,
    selectedTask: null,
    readModelLoadState,
    role: "build",
    repoSettings,
    isLoadingRepoSettings: false,
    ...overrides,
  });

const deriveTranscriptState = ({
  projection,
  repoReadinessState,
}: {
  projection: ReturnType<typeof deriveSelectedSessionViewProjection>;
  repoReadinessState: "checking" | "ready";
}) =>
  deriveAgentSessionTranscriptState({
    source: projection.transcriptSource,
    repoReadinessState,
  });

describe("selected-session-view-source", () => {
  test("uses the loaded session as the selected-session source when available", () => {
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
    expect(
      deriveTranscriptState({
        projection,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "visible" });
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
    expect(
      deriveTranscriptState({
        projection,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "session_loading", reason: "preparing" });
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
    const inactiveProjection = project();

    expect(
      deriveTranscriptState({
        projection: selectedTaskProjection,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "empty", reason: "sessionless" });
    expect(
      deriveTranscriptState({
        projection: selectedTaskProjection,
        repoReadinessState: "checking",
      }),
    ).toEqual({ kind: "runtime_waiting" });
    expect(inactiveProjection.runtimeTarget).toEqual({
      kind: "inactive",
    });
    expect(
      deriveTranscriptState({
        projection: inactiveProjection,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "empty", reason: "inactive" });
  });

  test("waits for runtime readiness before resolving selected task read-model loading", () => {
    const projection = project({
      selectedTask: createTaskCardFixture(),
      readModelLoadState: loadingAgentSessionReadModelLoadState(repoPath),
    });

    expect(
      deriveTranscriptState({
        projection,
        repoReadinessState: "checking",
      }),
    ).toEqual({ kind: "runtime_waiting" });
    expect(
      deriveTranscriptState({
        projection,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "session_loading", reason: "preparing" });
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

    expect(
      deriveTranscriptState({
        projection,
        repoReadinessState: "ready",
      }),
    ).toEqual({
      kind: "failed",
      message: "Session history failed",
    });
  });
});
