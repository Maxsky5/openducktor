import { describe, expect, test } from "bun:test";
import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { SetURLSearchParams } from "react-router";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioQuerySync } from "./query-sync/use-agent-studio-query-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioQuerySync>[0];
type SearchParamsCall = Parameters<SetURLSearchParams>;

const withDefaults = (
  overrides: Partial<HookArgs> & Pick<HookArgs, "activeWorkspaceId">,
): HookArgs => ({
  agentStudioState: null,
  isLoadingAgentStudioState: false,
  agentStudioStateError: null,
  retryAgentStudioStateLoad: () => {},
  locationKey: "location-1",
  navigationType: "REPLACE",
  searchParams: new URLSearchParams(),
  setSearchParams: () => {},
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioQuerySync, initialProps);

describe("useAgentStudioQuerySync", () => {
  test("parses URL state and writes query updates", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };
    const harness = createHookHarness(
      withDefaults({
        activeWorkspaceId: null,
        searchParams: new URLSearchParams("task=task-1&agent=build"),
        setSearchParams,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().taskIdParam).toBe("task-1");
    expect(harness.getLatest().roleFromQuery).toBe("build");
    await harness.run((state) => state.updateQuery({ session: "session-1" }));

    const lastCall = calls.at(-1);
    if (!lastCall || !(lastCall[0] instanceof URLSearchParams)) {
      throw new Error("Expected a URLSearchParams update.");
    }
    expect(lastCall[0].toString()).toBe("task=task-1&session=session-1&agent=build");
    expect(lastCall[1]).toEqual({ replace: true });
    await harness.unmount();
  });

  test("accepts a new external URL location", async () => {
    const setSearchParams: SetURLSearchParams = () => {};
    const harness = createHookHarness(
      withDefaults({
        activeWorkspaceId: null,
        searchParams: new URLSearchParams("task=task-1&agent=spec"),
        setSearchParams,
      }),
    );

    await harness.mount();
    await harness.update(
      withDefaults({
        activeWorkspaceId: null,
        locationKey: "location-2",
        navigationType: "POP",
        searchParams: new URLSearchParams("task=task-2&session=session-2&agent=planner"),
        setSearchParams,
      }),
    );

    expect(harness.getLatest().taskIdParam).toBe("task-2");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-2");
    expect(harness.getLatest().roleFromQuery).toBe("planner");
    await harness.unmount();
  });

  test("restores task, role, and external session from workspace state", async () => {
    const state: WorkspaceAgentStudioState = {
      openTaskIds: ["task-saved"],
      activeTask: {
        taskId: "task-saved",
        role: "qa",
        externalSessionId: "session-saved",
      },
    };
    const harness = createHookHarness(
      withDefaults({ activeWorkspaceId: "repo-a", agentStudioState: state }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.isWorkspaceStateLoaded);

    expect(harness.getLatest().taskIdParam).toBe("task-saved");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-saved");
    expect(harness.getLatest().roleFromQuery).toBe("qa");
    await harness.unmount();
  });

  test("keeps a direct route active while workspace state loads", async () => {
    const route = new URLSearchParams("task=task-url&session=session-url&agent=build");
    const harness = createHookHarness(
      withDefaults({
        activeWorkspaceId: "repo-a",
        isLoadingAgentStudioState: true,
        searchParams: route,
      }),
    );

    await harness.mount();

    expect(harness.getLatest().isWorkspaceRestorePending).toBeFalse();
    expect(harness.getLatest().taskIdParam).toBe("task-url");

    await harness.update(
      withDefaults({
        activeWorkspaceId: "repo-a",
        agentStudioState: {
          openTaskIds: ["task-saved"],
          activeTask: { taskId: "task-saved", role: "qa" },
        },
        searchParams: route,
      }),
    );
    await harness.waitFor((result) => result.isWorkspaceStateLoaded);

    expect(harness.getLatest().taskIdParam).toBe("task-url");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-url");
    expect(harness.getLatest().roleFromQuery).toBe("build");
    await harness.unmount();
  });

  test("keeps direct-link URL parameters authoritative", async () => {
    const harness = createHookHarness(
      withDefaults({
        activeWorkspaceId: "repo-a",
        agentStudioState: {
          openTaskIds: ["task-saved"],
          activeTask: { taskId: "task-saved", role: "qa" },
        },
        searchParams: new URLSearchParams("task=task-url&session=session-url&agent=build"),
      }),
    );

    await harness.mount();
    await harness.waitFor((result) => result.isWorkspaceStateLoaded);
    expect(harness.getLatest().taskIdParam).toBe("task-url");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-url");
    expect(harness.getLatest().roleFromQuery).toBe("build");
    await harness.unmount();
  });
});
