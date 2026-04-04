import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
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

afterAll(async () => {
  await restoreMockedModules([
    [
      "@/components/features/task-details/use-task-documents",
      () => import("@/components/features/task-details/use-task-documents"),
    ],
  ]);
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
      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
      expect(reloadDocumentMock).toHaveBeenCalledWith("spec");
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
        updatedAt: null,
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
      expect(reloadDocumentMock).toHaveBeenCalledWith("plan");
    } finally {
      await harness.unmount();
    }
  });

  test("dedupes completed tool refreshes for the same message across rerenders", async () => {
    const toolMessage = createCompletedToolMessage({
      id: "message-dedupe",
      tool: "odt_set_plan",
      input: { markdown: "# Saved plan" },
      output: "done",
    });
    const baseArgs = {
      ...createBaseArgs(),
      selectedTask: null,
      activeSession: createAgentSessionFixture({
        runtimeKind: "opencode",
        sessionId: "session-dedupe",
        messages: [toolMessage],
      }),
    };
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
      expect(reloadDocumentMock).toHaveBeenCalledWith("plan");

      await harness.update({
        ...baseArgs,
        activeSession: createAgentSessionFixture({
          runtimeKind: "opencode",
          sessionId: "session-dedupe",
          messages: [toolMessage],
        }),
      });

      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for repo context before processing completed workflow document events", async () => {
    const toolMessage = createCompletedToolMessage({
      id: "message-repo-hydration",
      tool: "odt_set_plan",
      input: { markdown: "# Hydrated plan" },
      output: "completed 2026-02-22T09:15:00.000Z",
    });
    const baseArgs = {
      ...createBaseArgs(),
      selectedTask: null,
      activeRepo: null,
      activeSession: createAgentSessionFixture({
        runtimeKind: "opencode",
        sessionId: "session-repo-hydration",
        messages: [toolMessage],
      }),
    };
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      expect(applyDocumentUpdateMock).not.toHaveBeenCalled();
      expect(reloadDocumentMock).not.toHaveBeenCalled();

      await harness.update({
        ...baseArgs,
        activeRepo: "/repo",
      });

      expect(applyDocumentUpdateMock).toHaveBeenCalledTimes(1);
      expect(applyDocumentUpdateMock).toHaveBeenCalledWith("plan", {
        markdown: "# Hydrated plan",
        updatedAt: "2026-02-22T09:15:00.000Z",
      });
      expect(reloadDocumentMock).toHaveBeenCalledTimes(1);
      expect(reloadDocumentMock).toHaveBeenCalledWith("plan");
    } finally {
      await harness.unmount();
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
