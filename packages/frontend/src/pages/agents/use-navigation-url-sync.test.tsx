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
    const originalDateNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      const harness = createHookHarness({
        navigationType: "REPLACE",
        searchParams: new URLSearchParams("task=task-1&agent=build&autostart=1&start=now"),
        setSearchParams,
      });

      await harness.mount();
      expect(harness.getLatest().navigation).toMatchObject({
        taskId: "task-1",
        externalSessionId: null,
        role: "build",
      });
      calls.length = 0;
      now += 101;

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
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("syncs local navigation state when search params change externally", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      navigationType: "REPLACE",
      searchParams: new URLSearchParams("task=task-1&agent=spec"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      externalSessionId: null,
      role: "spec",
    });
    expect(calls).toHaveLength(0);

    await harness.update({
      navigationType: "POP",
      searchParams: new URLSearchParams("task=task-2&session=session-2&agent=planner"),
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-2",
      externalSessionId: "session-2",
      role: "planner",
    });
    expect(calls).toHaveLength(0);

    await harness.unmount();
  });

  test("ignores stale self-authored URL echoes while newer local navigation is pending", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      navigationType: "REPLACE",
      searchParams: new URLSearchParams("task=task-1&agent=build&autostart=1&start=now"),
      setSearchParams,
    });

    await harness.mount();
    const mountCleanupCall = calls[0];
    if (!mountCleanupCall) {
      throw new Error("Expected mount cleanup to normalize one-time URL params");
    }

    await harness.run((latest) => {
      latest.updateQuery({ session: "session-1" });
    });

    const sessionWriteCall = calls[1];
    if (!sessionWriteCall) {
      throw new Error("Expected a second setSearchParams call after the session update");
    }

    const [firstNext] = mountCleanupCall;
    const [secondNext] = sessionWriteCall;
    if (!(firstNext instanceof URLSearchParams) || !(secondNext instanceof URLSearchParams)) {
      throw new Error("Expected URLSearchParams");
    }

    await harness.update({
      navigationType: "REPLACE",
      searchParams: firstNext,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      externalSessionId: "session-1",
      role: "build",
    });
    expect(calls).toHaveLength(2);

    await harness.update({
      navigationType: "REPLACE",
      searchParams: secondNext,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      externalSessionId: "session-1",
      role: "build",
    });
    expect(calls).toHaveLength(2);

    await harness.unmount();
  });

  test("treats matching browser back navigations as external URL changes", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };

    const harness = createHookHarness({
      navigationType: "REPLACE",
      searchParams: new URLSearchParams("task=task-1&agent=build&autostart=1&start=now"),
      setSearchParams,
    });

    await harness.mount();
    await harness.run((latest) => {
      latest.updateQuery({ session: "session-1" });
    });

    const mountCleanupCall = calls[0];
    if (!mountCleanupCall) {
      throw new Error("Expected mount cleanup to normalize one-time URL params");
    }

    const [previousUrl] = mountCleanupCall;
    if (!(previousUrl instanceof URLSearchParams)) {
      throw new Error("Expected URLSearchParams");
    }

    await harness.update({
      navigationType: "POP",
      searchParams: previousUrl,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      externalSessionId: null,
      role: "build",
    });
    expect(calls).toHaveLength(2);

    await harness.unmount();
  });
});
