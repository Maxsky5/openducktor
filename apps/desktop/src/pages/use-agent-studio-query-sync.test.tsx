import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentStudioQuerySync>[0];
type HookState = ReturnType<typeof useAgentStudioQuerySync>;

type SearchParamsCall = Parameters<SetURLSearchParams>;

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4000",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createTask = (id: string): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;
  const currentProps = initialProps;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioQuerySync(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, currentProps));
      await flush();
    });
  };

  const run = async (fn: (state: HookState) => void | Promise<void>): Promise<void> => {
    await act(async () => {
      if (!latest) {
        throw new Error("Hook state unavailable");
      }
      await fn(latest);
      await flush();
    });
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, unmount };
};

describe("useAgentStudioQuerySync", () => {
  test("updateQuery writes search params when values change", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      activeRepo: null,
      searchParams: new URLSearchParams("task=task-1"),
      setSearchParams,
      taskIdParam: "task-1",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      selectedSessionById: null,
      activeSession: null,
      isLoadingTasks: true,
      tasks: [createTask("task-1")],
    });

    await harness.mount();
    await harness.run((state) => {
      state.updateQuery({ session: "session-1" });
    });

    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    if (!firstCall) {
      throw new Error("Expected setSearchParams to be called");
    }
    const [next] = firstCall;
    expect(next instanceof URLSearchParams).toBe(true);
    if (next instanceof URLSearchParams) {
      expect(next.get("task")).toBe("task-1");
      expect(next.get("session")).toBe("session-1");
    }

    await harness.unmount();
  });

  test("clears invalid task query when task is missing", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      activeRepo: null,
      searchParams: new URLSearchParams(
        "task=missing&agent=spec&scenario=spec_initial&autostart=1&start=continue",
      ),
      setSearchParams,
      taskIdParam: "missing",
      taskId: "missing",
      role: "spec",
      scenario: "spec_initial",
      selectedSessionById: null,
      activeSession: null,
      isLoadingTasks: false,
      tasks: [],
    });

    await harness.mount();

    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0];
    if (!firstCall) {
      throw new Error("Expected setSearchParams to be called");
    }
    const [next] = firstCall;
    expect(next instanceof URLSearchParams).toBe(true);
    if (next instanceof URLSearchParams) {
      expect(next.get("task")).toBeNull();
      expect(next.get("session")).toBeNull();
      expect(next.get("agent")).toBeNull();
      expect(next.get("scenario")).toBeNull();
      expect(next.get("autostart")).toBeNull();
      expect(next.get("start")).toBeNull();
    }

    await harness.unmount();
  });

  test("syncs task param from selected session when mismatched", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      activeRepo: null,
      searchParams: new URLSearchParams("task=task-old"),
      setSearchParams,
      taskIdParam: "task-old",
      taskId: "task-new",
      role: "spec",
      scenario: "spec_initial",
      selectedSessionById: createSession({ taskId: "task-new" }),
      activeSession: null,
      isLoadingTasks: true,
      tasks: [createTask("task-new")],
    });

    await harness.mount();

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    if (!lastCall) {
      throw new Error("Expected setSearchParams to be called");
    }
    const [next] = lastCall;
    expect(next instanceof URLSearchParams).toBe(true);
    if (next instanceof URLSearchParams) {
      expect(next.get("task")).toBe("task-new");
    }

    await harness.unmount();
  });
});
