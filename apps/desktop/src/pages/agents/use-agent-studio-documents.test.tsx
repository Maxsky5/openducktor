import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

type DocumentSectionKey = "spec" | "plan" | "qa";

type TaskDocumentPayload = {
  markdown: string;
  updatedAt: string | null;
};

type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

type TaskDocumentsState = {
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
};

type UseTaskDocumentsReturn = TaskDocumentsState & {
  ensureDocumentLoaded: (section: DocumentSectionKey) => boolean;
  reloadDocument: (section: DocumentSectionKey) => boolean;
  applyDocumentUpdate: (section: DocumentSectionKey, payload: TaskDocumentPayload) => void;
};

const createDocumentState = (overrides: Partial<TaskDocumentState> = {}): TaskDocumentState => ({
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
  ...overrides,
});

let taskDocumentsState: TaskDocumentsState = {
  specDoc: createDocumentState(),
  planDoc: createDocumentState(),
  qaDoc: createDocumentState(),
};
const taskDocumentsHookCalls: Array<{
  taskId: string | null;
  open: boolean;
  cacheScope: string;
}> = [];

const ensureDocumentLoadedMock = mock((_section: DocumentSectionKey) => true);
const reloadDocumentMock = mock((_section: DocumentSectionKey) => true);
const applyDocumentUpdateMock = mock(
  (_section: DocumentSectionKey, _payload: TaskDocumentPayload) => {},
);

const setTaskDocumentsState = (overrides: Partial<TaskDocumentsState> = {}): void => {
  taskDocumentsState = {
    specDoc: createDocumentState(),
    planDoc: createDocumentState(),
    qaDoc: createDocumentState(),
    ...overrides,
  };
};

mock.module("@/components/features/task-details/use-task-documents", () => ({
  useTaskDocuments: (
    taskId: string | null,
    open: boolean,
    cacheScope = "",
  ): UseTaskDocumentsReturn => {
    taskDocumentsHookCalls.push({ taskId, open, cacheScope });
    return {
      specDoc: taskDocumentsState.specDoc,
      planDoc: taskDocumentsState.planDoc,
      qaDoc: taskDocumentsState.qaDoc,
      ensureDocumentLoaded: ensureDocumentLoadedMock,
      reloadDocument: reloadDocumentMock,
      applyDocumentUpdate: applyDocumentUpdateMock,
    };
  },
}));

type UseAgentStudioDocumentsHook =
  typeof import("./use-agent-studio-documents")["useAgentStudioDocuments"];

let useAgentStudioDocuments: UseAgentStudioDocumentsHook;

type HookArgs = Parameters<UseAgentStudioDocumentsHook>[0];
type AgentMessage = ReturnType<typeof createAgentSessionFixture>["messages"][number];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioDocuments, initialProps);

const createBaseArgs = (): HookArgs => ({
  activeRepo: "/repo",
  taskId: "task-1",
  activeSession: null,
  selectedTask: createTaskCardFixture({ id: "task-1", updatedAt: "2026-02-22T08:00:00.000Z" }),
});

const createCompletedToolMessage = ({
  id = "message-1",
  tool = "odt_set_spec",
  input,
  output,
  content = "",
}: {
  id?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  content?: string;
} = {}): AgentMessage => ({
  id,
  role: "tool",
  content,
  timestamp: "2026-02-22T08:10:00.000Z",
  meta: {
    kind: "tool",
    partId: `part-${id}`,
    callId: `call-${id}`,
    tool,
    status: "completed",
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  },
});

beforeAll(async () => {
  ({ useAgentStudioDocuments } = await import("./use-agent-studio-documents"));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  setTaskDocumentsState();
  taskDocumentsHookCalls.length = 0;
  reloadDocumentMock.mockClear();
  applyDocumentUpdateMock.mockClear();
});

describe("useAgentStudioDocuments", () => {
  test("loads each document section and refreshes when task updatedAt changes", async () => {
    const baseArgs = createBaseArgs();
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();

      expect(reloadDocumentMock).toHaveBeenCalledTimes(3);
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(1, "spec");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(2, "plan");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(3, "qa");

      await harness.update({
        ...baseArgs,
        selectedTask: createTaskCardFixture({
          id: "task-1",
          updatedAt: "2026-02-22T08:00:00.000Z",
        }),
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(3);

      await harness.update({
        ...baseArgs,
        selectedTask: createTaskCardFixture({
          id: "task-1",
          updatedAt: "2026-02-22T08:30:00.000Z",
        }),
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(6);
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(4, "spec");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(5, "plan");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(6, "qa");
    } finally {
      await harness.unmount();
    }
  });

  test("reloads documents when document summary timestamps change without task updatedAt changing", async () => {
    const baseArgs = createBaseArgs();
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      expect(reloadDocumentMock).toHaveBeenCalledTimes(3);

      await harness.update({
        ...baseArgs,
        selectedTask: createTaskCardFixture({
          id: "task-1",
          updatedAt: baseArgs.selectedTask?.updatedAt ?? "2026-02-22T08:00:00.000Z",
          documentSummary: {
            spec: {
              has: true,
              updatedAt: "2026-02-22T08:45:00.000Z",
            },
            plan: {
              has: false,
            },
            qaReport: {
              has: false,
              verdict: "not_reviewed",
            },
          },
        }),
      });

      expect(reloadDocumentMock).toHaveBeenCalledTimes(6);
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(4, "spec");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(5, "plan");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(6, "qa");
    } finally {
      await harness.unmount();
    }
  });

  test("scopes document cache and refresh dedupe by active repo", async () => {
    const baseArgs = createBaseArgs();
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      expect(taskDocumentsHookCalls[taskDocumentsHookCalls.length - 1]).toMatchObject({
        taskId: "task-1",
        open: true,
        cacheScope: "/repo",
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(3);

      await harness.update({
        ...baseArgs,
        activeRepo: "/other-repo",
      });

      expect(taskDocumentsHookCalls[taskDocumentsHookCalls.length - 1]).toMatchObject({
        taskId: "task-1",
        open: true,
        cacheScope: "/other-repo",
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(6);
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(4, "spec");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(5, "plan");
      expect(reloadDocumentMock).toHaveBeenNthCalledWith(6, "qa");
    } finally {
      await harness.unmount();
    }
  });

  test("applies optimistic updates from completed workflow tool messages", async () => {
    setTaskDocumentsState({
      specDoc: createDocumentState({
        markdown: "# Old spec",
        updatedAt: "2026-02-22T08:00:00.000Z",
      }),
    });

    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "session-1",
      messages: [
        createCompletedToolMessage({
          tool: "odt_set_spec",
          input: { markdown: "# Updated spec" },
          output: "completed 2026-02-22T09:00:00.000Z",
        }),
      ],
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedTask: null,
      activeSession,
    });

    try {
      await harness.mount();

      expect(applyDocumentUpdateMock).toHaveBeenCalledTimes(1);
      expect(applyDocumentUpdateMock).toHaveBeenCalledWith("spec", {
        markdown: "# Updated spec",
        updatedAt: "2026-02-22T09:00:00.000Z",
      });
      expect(reloadDocumentMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("reloads section when completion timestamp is unavailable", async () => {
    setTaskDocumentsState({
      planDoc: createDocumentState({ markdown: "", updatedAt: null, isLoading: false }),
    });

    const activeSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      sessionId: "session-2",
      messages: [createCompletedToolMessage({ tool: "odt_set_plan", input: {}, output: "done" })],
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedTask: null,
      activeSession,
    });

    try {
      await harness.mount();
      expect(applyDocumentUpdateMock).not.toHaveBeenCalled();
      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
      expect(reloadDocumentMock).toHaveBeenCalledWith("plan");
    } finally {
      await harness.unmount();
    }
  });

  test("reuses optimistic update when completion timestamp is unavailable", async () => {
    setTaskDocumentsState({
      planDoc: createDocumentState({
        markdown: "",
        updatedAt: null,
        isLoading: false,
      }),
    });

    const activeSession = createAgentSessionFixture({
      sessionId: "session-3",
      messages: [
        createCompletedToolMessage({
          tool: "odt_set_plan",
          input: { markdown: "# Saved plan" },
          output: "done",
        }),
      ],
    });

    const harness = createHookHarness({
      ...createBaseArgs(),
      selectedTask: null,
      activeSession,
    });

    try {
      await harness.mount();
      expect(applyDocumentUpdateMock).toHaveBeenCalledTimes(1);
      expect(applyDocumentUpdateMock).toHaveBeenCalledWith("plan", {
        markdown: "# Saved plan",
        updatedAt: expect.any(String),
      });
      expect(reloadDocumentMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("retries completed tool messages after loading clears for spec/plan/qa", async () => {
    const scenarios = [
      { tool: "odt_set_spec", section: "spec" as const, sessionId: "session-spec-loading" },
      { tool: "odt_set_plan", section: "plan" as const, sessionId: "session-plan-loading" },
      { tool: "odt_qa_rejected", section: "qa" as const, sessionId: "session-qa-loading" },
    ] as const;

    for (const scenario of scenarios) {
      reloadDocumentMock.mockClear();
      applyDocumentUpdateMock.mockClear();

      setTaskDocumentsState({
        specDoc: createDocumentState({
          markdown: "",
          updatedAt: null,
          isLoading: scenario.section === "spec",
        }),
        planDoc: createDocumentState({
          markdown: "",
          updatedAt: null,
          isLoading: scenario.section === "plan",
        }),
        qaDoc: createDocumentState({
          markdown: "",
          updatedAt: null,
          isLoading: scenario.section === "qa",
        }),
      });

      const activeSession = createAgentSessionFixture({
        runtimeKind: "opencode",
        sessionId: scenario.sessionId,
        messages: [createCompletedToolMessage({ tool: scenario.tool, input: {}, output: "done" })],
      });

      const baseArgs = {
        ...createBaseArgs(),
        selectedTask: null,
        activeSession,
      };
      const harness = createHookHarness(baseArgs);

      try {
        await harness.mount();
        expect(reloadDocumentMock).not.toHaveBeenCalled();

        setTaskDocumentsState({
          specDoc: createDocumentState({ markdown: "", updatedAt: null, isLoading: false }),
          planDoc: createDocumentState({ markdown: "", updatedAt: null, isLoading: false }),
          qaDoc: createDocumentState({ markdown: "", updatedAt: null, isLoading: false }),
        });
        await harness.update(baseArgs);

        expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
        expect(reloadDocumentMock).toHaveBeenCalledWith(scenario.section);
      } finally {
        await harness.unmount();
      }
    }
  });

  test("resets processed tool-event context when switching sessions", async () => {
    setTaskDocumentsState({
      specDoc: createDocumentState({
        markdown: "# Old spec",
        updatedAt: "2026-02-22T08:00:00.000Z",
      }),
    });

    const toolMessage = createCompletedToolMessage({
      id: "shared-message-id",
      tool: "odt_set_spec",
      input: { markdown: "# Session update" },
      output: "completed 2026-02-22T08:45:00.000Z",
    });

    const baseArgs = createBaseArgs();
    const harness = createHookHarness({
      ...baseArgs,
      selectedTask: null,
      activeSession: createAgentSessionFixture({
        runtimeKind: "opencode",
        sessionId: "session-A",
        messages: [toolMessage],
      }),
    });

    try {
      await harness.mount();
      expect(applyDocumentUpdateMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...baseArgs,
        selectedTask: null,
        activeSession: createAgentSessionFixture({
          runtimeKind: "opencode",
          sessionId: "session-B",
          messages: [toolMessage],
        }),
      });

      expect(applyDocumentUpdateMock).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });
});
