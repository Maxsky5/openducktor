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
import {
  projectSelectedSessionViewSource,
  resolveSelectedSessionViewSource,
} from "./selected-session-view-source";

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

const project = (source: ReturnType<typeof resolveSelectedSessionViewSource>) =>
  projectSelectedSessionViewSource({
    source,
    role: "build",
    repoSettings,
    isLoadingRepoSettings: false,
  });

const deriveTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: ReturnType<typeof resolveSelectedSessionViewSource>;
  repoReadinessState: "checking" | "ready";
}) =>
  deriveAgentSessionTranscriptState({
    source: project(source).transcriptSource,
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
    const source = resolveSelectedSessionViewSource({
      selectedSessionIdentity: toAgentSessionIdentity(session),
      session,
      sessionSummary: createAgentSessionSummaryFixture({ externalSessionId: "session-1" }),
      selectedTask: createTaskCardFixture(),
      readModelLoadState,
    });

    expect(source.kind).toBe("loaded_session");
    const projection = project(source);
    expect(projection.activityState).toBe("running");
    expect(projection.selectedModel).toBe(session.selectedModel);
    expect(projection.runtimeTarget).toEqual({ kind: "runtime", runtimeKind: "opencode" });
    expect(
      deriveTranscriptState({
        source,
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
    const source = resolveSelectedSessionViewSource({
      selectedSessionIdentity: toAgentSessionIdentity(summary),
      session: null,
      sessionSummary: summary,
      selectedTask: createTaskCardFixture(),
      readModelLoadState,
    });

    expect(source.kind).toBe("selected_session");
    const projection = project(source);
    expect(projection.activityState).toBe("waiting_input");
    expect(projection.selectedModel).toBe(summary.selectedModel);
    expect(projection.runtimeTarget).toEqual({ kind: "runtime", runtimeKind: "codex" });
    expect(
      deriveTranscriptState({
        source,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("uses repository settings as the runtime target for sessionless selected tasks", () => {
    const selectedTaskSource = resolveSelectedSessionViewSource({
      selectedSessionIdentity: null,
      session: null,
      sessionSummary: null,
      selectedTask: createTaskCardFixture(),
      readModelLoadState,
    });

    const selectedTaskProjection = project(selectedTaskSource);
    expect(selectedTaskProjection.activityState).toBeNull();
    expect(selectedTaskProjection.selectedModel).toBeNull();
    expect(selectedTaskProjection.runtimeTarget).toEqual({
      kind: "runtime",
      runtimeKind: "codex",
    });
  });

  test("keeps sessionless selected tasks resolving while repository settings load", () => {
    const selectedTaskSource = resolveSelectedSessionViewSource({
      selectedSessionIdentity: null,
      session: null,
      sessionSummary: null,
      selectedTask: createTaskCardFixture(),
      readModelLoadState,
    });
    const selectedTaskProjection = projectSelectedSessionViewSource({
      source: selectedTaskSource,
      role: "build",
      repoSettings: null,
      isLoadingRepoSettings: true,
    });

    expect(selectedTaskProjection.runtimeTarget).toEqual({ kind: "resolving" });
  });

  test("distinguishes sessionless selected tasks from inactive selections", () => {
    const selectedTaskSource = resolveSelectedSessionViewSource({
      selectedSessionIdentity: null,
      session: null,
      sessionSummary: null,
      selectedTask: createTaskCardFixture(),
      readModelLoadState,
    });
    const inactiveSource = resolveSelectedSessionViewSource({
      selectedSessionIdentity: null,
      session: null,
      sessionSummary: null,
      selectedTask: null,
      readModelLoadState,
    });

    expect(
      deriveTranscriptState({
        source: selectedTaskSource,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "empty", reason: "sessionless" });
    expect(
      deriveTranscriptState({
        source: selectedTaskSource,
        repoReadinessState: "checking",
      }),
    ).toEqual({ kind: "runtime_waiting" });
    expect(project(inactiveSource).runtimeTarget).toEqual({
      kind: "inactive",
    });
    expect(
      deriveTranscriptState({
        source: inactiveSource,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "empty", reason: "inactive" });
  });

  test("waits for runtime readiness before resolving selected task read-model loading", () => {
    const source = resolveSelectedSessionViewSource({
      selectedSessionIdentity: null,
      session: null,
      sessionSummary: null,
      selectedTask: createTaskCardFixture(),
      readModelLoadState: loadingAgentSessionReadModelLoadState(repoPath),
    });

    expect(
      deriveTranscriptState({
        source,
        repoReadinessState: "checking",
      }),
    ).toEqual({ kind: "runtime_waiting" });
    expect(
      deriveTranscriptState({
        source,
        repoReadinessState: "ready",
      }),
    ).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("surfaces selected session read-model failures", () => {
    const summary = createAgentSessionSummaryFixture({
      externalSessionId: "session-3",
      runtimeKind: "codex",
    });
    const source = resolveSelectedSessionViewSource({
      selectedSessionIdentity: toAgentSessionIdentity(summary),
      session: null,
      sessionSummary: summary,
      selectedTask: createTaskCardFixture(),
      readModelLoadState: failedAgentSessionReadModelLoadState(repoPath, "Session history failed"),
    });

    expect(
      deriveTranscriptState({
        source,
        repoReadinessState: "ready",
      }),
    ).toEqual({
      kind: "failed",
      message: "Session history failed",
    });
  });
});
