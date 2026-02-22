import { describe, expect, test } from "bun:test";
import type { SetURLSearchParams } from "react-router-dom";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioQuerySync>[0];
type HookState = ReturnType<typeof useAgentStudioQuerySync>;

type SearchParamsCall = Parameters<SetURLSearchParams>;

const createSession = (overrides = {}) => createAgentSessionFixture(overrides);

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioQuerySync, initialProps);

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
