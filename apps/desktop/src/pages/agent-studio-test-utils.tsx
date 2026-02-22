import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

type ReactActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

export const enableReactActEnvironment = (): void => {
  (globalThis as ReactActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
};

export const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

export const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
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
  ...overrides,
});

export const createAgentSessionFixture = (
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState => ({
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

type HookRunner<State> = (state: State) => void | Promise<void>;

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
) => {
  let latest: State | null = null;
  let currentProps = initialProps;

  const Harness = ({ hookProps }: { hookProps: Props }): ReactElement | null => {
    latest = useHook(hookProps);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, { hookProps: currentProps }));
      await flushMicrotasks();
    });
  };

  const update = async (nextProps: Props): Promise<void> => {
    currentProps = nextProps;
    await act(async () => {
      renderer?.update(createElement(Harness, { hookProps: currentProps }));
      await flushMicrotasks();
    });
  };

  const run = async (fn: HookRunner<State>): Promise<void> => {
    await act(async () => {
      if (!latest) {
        throw new Error("Hook state unavailable");
      }
      await fn(latest);
      await flushMicrotasks();
    });
  };

  const getLatest = (): State => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const waitFor = async (
    predicate: (state: State) => boolean,
    timeoutMs = 500,
    intervalMs = 5,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (latest && predicate(latest)) {
        return;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        await flushMicrotasks();
      });
    }

    throw new Error("Timed out waiting for hook state");
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flushMicrotasks();
    });
  };

  return { mount, update, run, getLatest, waitFor, unmount };
};
