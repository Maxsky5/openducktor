import { describe, expect, test } from "bun:test";
import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import type { AgentStudioSelectionState } from "./shell/agent-studio-selection-state";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskTabs>[0];

const createTask = (id: string, status: "open" | "closed" = "open") =>
  createTaskCardFixture({ id, title: id, status });

const withDefaults = (overrides: Partial<HookArgs> = {}): HookArgs => {
  const agentStudioState = overrides.agentStudioState ?? { openTaskIds: [] };
  return {
    activeWorkspaceId: "repo-a",
    loadedAgentStudioState: overrides.loadedAgentStudioState ?? agentStudioState,
    agentStudioStateLoadKey: overrides.agentStudioStateLoadKey ?? "1:1",
    agentStudioState,
    taskId: "",
    selectedTask: null,
    tasks: [],
    tasksAreCurrent: true,
    latestSessionByTaskId: new Map(),
    selectAgentStudioSelection: () => {},
    ...overrides,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskTabs, initialProps);

describe("useAgentStudioTaskTabs", () => {
  test("restores order and active task from workspace state", async () => {
    const state: WorkspaceAgentStudioState = {
      openTaskIds: ["task-2", "task-1"],
      activeTask: { taskId: "task-2", role: "build" },
    };
    const harness = createHookHarness(
      withDefaults({
        agentStudioState: state,
        taskId: "task-2",
        selectedTask: createTask("task-2"),
        tasks: [createTask("task-1"), createTask("task-2")],
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.loadedStateWorkspaceId === "repo-a");

    expect(harness.getLatest().tabTaskIds).toEqual(["task-2", "task-1"]);
    expect(harness.getLatest().activeTaskTabId).toBe("task-2");
    await harness.unmount();
  });

  test("filters unknown and closed task ids and deduplicates in first-seen order", async () => {
    const harness = createHookHarness(
      withDefaults({
        agentStudioState: {
          openTaskIds: ["unknown", "task-2", "task-1", "task-2", "closed"],
          activeTask: { taskId: "task-2" },
        },
        taskId: "task-2",
        selectedTask: createTask("task-2"),
        tasks: [createTask("task-1"), createTask("task-2"), createTask("closed", "closed")],
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.tabTaskIds.length === 2);
    expect(harness.getLatest().tabTaskIds).toEqual(["task-2", "task-1"]);
    await harness.unmount();
  });

  test("adds a valid direct-link task without replacing saved order", async () => {
    const harness = createHookHarness(
      withDefaults({
        agentStudioState: { openTaskIds: ["task-1"] },
        taskId: "task-2",
        selectedTask: createTask("task-2"),
        tasks: [createTask("task-1"), createTask("task-2")],
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.tabTaskIds.length === 2);
    expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);
    expect(harness.getLatest().activeTaskTabId).toBe("task-2");
    await harness.unmount();
  });

  test("shows a direct-link task before workspace state loads", async () => {
    const task = createTask("task-2");
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      loadedAgentStudioState: null,
      agentStudioStateLoadKey: null,
      agentStudioState: null,
      taskId: "task-2",
      selectedTask: task,
      tasks: [task],
      tasksAreCurrent: true,
      latestSessionByTaskId: new Map(),
      selectAgentStudioSelection: () => {},
    });

    await harness.mount();

    expect(harness.getLatest().tabTaskIds).toEqual(["task-2"]);
    expect(harness.getLatest().activeTaskTabId).toBe("task-2");
    await harness.unmount();
  });

  test("selects tabs with task-only navigation", async () => {
    const selections: AgentStudioSelectionState[] = [];
    const harness = createHookHarness(
      withDefaults({
        agentStudioState: {
          openTaskIds: ["task-1", "task-2"],
          activeTask: { taskId: "task-1" },
        },
        taskId: "task-1",
        selectedTask: createTask("task-1"),
        tasks: [createTask("task-1"), createTask("task-2")],
        selectAgentStudioSelection: (selection) => selections.push(selection),
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.loadedStateWorkspaceId === "repo-a");
    await harness.run((result) => result.handleSelectTab("task-2"));

    expect(selections.at(-1)).toMatchObject({
      taskId: "task-2",
      sessionExternalId: null,
      sessionIdentity: null,
    });
    await harness.unmount();
  });

  test("keeps a local tab draft when the same workspace snapshot reloads", async () => {
    const loadedState: WorkspaceAgentStudioState = {
      openTaskIds: ["task-1"],
      activeTask: { taskId: "task-1" },
    };
    const allTasks = [createTask("task-1"), createTask("task-2")];
    const harness = createHookHarness(
      withDefaults({
        loadedAgentStudioState: loadedState,
        agentStudioStateLoadKey: "1:1",
        agentStudioState: loadedState,
        taskId: "task-1",
        selectedTask: allTasks[0] ?? null,
        tasks: allTasks,
      }),
    );

    await harness.mount();
    await harness.run((result) => result.handleSelectTab("task-2"));
    expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);

    await harness.update(
      withDefaults({
        loadedAgentStudioState: loadedState,
        agentStudioStateLoadKey: "1:1",
        agentStudioState: loadedState,
        taskId: "",
        selectedTask: null,
        tasks: allTasks,
      }),
    );

    expect(harness.getLatest().tabTaskIds).toEqual(["task-1", "task-2"]);
    expect(harness.getLatest().activeTaskTabId).toBe("task-2");
    await harness.unmount();
  });

  test("clears tabs when the active workspace is removed", async () => {
    const harness = createHookHarness(
      withDefaults({
        agentStudioState: { openTaskIds: ["task-1"] },
        taskId: "task-1",
        selectedTask: createTask("task-1"),
        tasks: [createTask("task-1")],
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.tabTaskIds.length === 1);
    await harness.update(
      withDefaults({ activeWorkspaceId: null, agentStudioState: null, tasks: [] }),
    );
    await harness.waitFor((result) => result.tabTaskIds.length === 0);

    expect(harness.getLatest().loadedStateWorkspaceId).toBeNull();
    await harness.unmount();
  });
});
