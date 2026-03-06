import { describe, expect, test } from "bun:test";
import type { SetURLSearchParams } from "react-router-dom";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useNavigationUrlSync } from "./use-navigation-url-sync";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useNavigationUrlSync>[0];
type SearchParamsCall = Parameters<SetURLSearchParams>;

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useNavigationUrlSync, initialProps);

describe("useNavigationUrlSync", () => {
  test("parses initial search params and syncs navigation updates back into the URL", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      searchParams: new URLSearchParams("task=task-1&agent=build&autostart=1&start=now"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionId: null,
      role: "build",
    });

    await harness.run((latest) => {
      latest.updateQuery({ session: "session-1" });
    });

    const lastCall = calls[calls.length - 1];
    if (!lastCall) {
      throw new Error("Expected setSearchParams to be called");
    }

    const [next, options] = lastCall;
    if (!(next instanceof URLSearchParams)) {
      throw new Error("Expected URLSearchParams");
    }

    expect(next.get("task")).toBe("task-1");
    expect(next.get("session")).toBe("session-1");
    expect(next.get("agent")).toBe("build");
    expect(next.get("autostart")).toBeNull();
    expect(next.get("start")).toBeNull();
    expect(options).toEqual({ replace: true });

    await harness.unmount();
  });

  test("syncs local navigation state when search params change externally", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      searchParams: new URLSearchParams("task=task-1&agent=spec"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionId: null,
      role: "spec",
    });
    expect(calls).toHaveLength(0);

    await harness.update({
      searchParams: new URLSearchParams("task=task-2&session=session-2&agent=planner"),
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-2",
      sessionId: "session-2",
      role: "planner",
    });
    expect(calls).toHaveLength(0);

    await harness.unmount();
  });
});
