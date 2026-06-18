import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { readyAgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
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
    const projection = projectSelectedSessionViewSource(source);
    expect(projection.activityState).toBe("running");
    expect(projection.selectedModel).toBe(session.selectedModel);
    expect(projection.runtimeTargetSource).toEqual({
      kind: "selected_session",
      runtimeKind: "opencode",
    });
    expect(projection.transcriptSource).toEqual({
      kind: "loaded_session",
      session,
    });
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
    const projection = projectSelectedSessionViewSource(source);
    expect(projection.activityState).toBe("waiting_input");
    expect(projection.selectedModel).toBe(summary.selectedModel);
    expect(projection.runtimeTargetSource).toEqual({
      kind: "selected_session",
      runtimeKind: "codex",
    });
    expect(projection.transcriptSource).toEqual({
      kind: "selected_session",
      readModelLoadState,
    });
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

    const selectedTaskProjection = projectSelectedSessionViewSource(selectedTaskSource);
    const inactiveProjection = projectSelectedSessionViewSource(inactiveSource);
    expect(selectedTaskProjection.activityState).toBeNull();
    expect(selectedTaskProjection.selectedModel).toBeNull();
    expect(selectedTaskProjection.runtimeTargetSource).toEqual({
      kind: "selected_task",
    });
    expect(selectedTaskProjection.transcriptSource).toEqual({
      kind: "selected_task",
      readModelLoadState,
    });
    expect(inactiveProjection.runtimeTargetSource).toEqual({
      kind: "inactive",
    });
    expect(inactiveProjection.transcriptSource).toEqual({
      kind: "inactive",
    });
  });
});
