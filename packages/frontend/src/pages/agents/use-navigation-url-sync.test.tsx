import { describe, expect, test } from "bun:test";
import type { SetURLSearchParams } from "react-router";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { useLayoutEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  test("commits an external session address with its new selection on the first render", () => {
    const commits: { address: string | null; task: string }[] = [];
    function Session() {
      const location = useLocation();
      const navigate = useNavigate();
      const [searchParams, setSearchParams] = useSearchParams();
      const navigationType = useNavigationType();
      const { navigation } = useNavigationUrlSync({
        workspaceId: "w",
        locationKey: location.key,
        navigationType,
        searchParams,
        setSearchParams,
      });
      useLayoutEffect(() => {
        commits.push({ address: searchParams.get("task"), task: navigation.taskId });
      });
      return (
        <button
          onClick={() =>
            void navigate(
              "/sessions?workspace=w&task=next&session=native-next&agent=build&runtimeKind=claude&workingDirectory=%2Fnext",
            )
          }
        >
          Open next session
        </button>
      );
    }
    const view = render(
      <MemoryRouter
        initialEntries={[
          "/sessions?workspace=w&task=first&session=native-first&agent=qa&runtimeKind=codex&workingDirectory=%2Ffirst",
        ]}
      >
        <Session />
      </MemoryRouter>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open next session" }));
      expect(commits.filter((commit) => commit.address === "next").length).toBeGreaterThan(0);
      expect(commits.filter((commit) => commit.address !== commit.task)).toEqual([]);
    } finally {
      view.unmount();
    }
  });
  test("starts from caller state and writes it to the URL once", async () => {
    const calls: SearchParamsCall[] = [];
    const setSearchParams: SetURLSearchParams = (nextInit, navigateOptions) => {
      calls.push([nextInit, navigateOptions]);
    };
    const harness = createHookHarness({
      workspaceId: "w",
      initialNavigation: {
        taskId: "task-1",
        sessionExternalId: "session-1",
        sessionIdentity: null,
        role: "planner",
      },
      locationKey: "location-1",
      navigationType: "REPLACE",
      searchParams: new URLSearchParams(),
      setSearchParams,
    });

    await harness.mount();
    await harness.update({
      workspaceId: "w",
      initialNavigation: {
        taskId: "task-1",
        sessionExternalId: "session-1",
        sessionIdentity: null,
        role: "planner",
      },
      locationKey: "location-1",
      navigationType: "REPLACE",
      searchParams: new URLSearchParams(),
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toEqual({
      taskId: "task-1",
      sessionExternalId: "session-1",
      sessionIdentity: null,
      role: "planner",
    });
    expect(calls).toHaveLength(1);
    const [next, options] = calls[0] ?? [];
    expect(next?.toString()).toBe("task=task-1&session=session-1&agent=planner");
    expect(options).toEqual({ replace: true });
    await harness.unmount();
  });

  test("keeps a complete session identity in the address on mount", async () => {
    const calls: SearchParamsCall[] = [];
    const harness = createHookHarness({
      workspaceId: "w",
      locationKey: "location-1",
      navigationType: "PUSH",
      searchParams: new URLSearchParams(
        "workspace=w&kind=task&task=task-1&session=native&agent=build&runtimeKind=codex&workingDirectory=%2Frepo",
      ),
      setSearchParams: (nextInit, navigateOptions) => {
        calls.push([nextInit, navigateOptions]);
      },
    });

    await harness.mount();

    expect(harness.getLatest().navigation.sessionIdentity).toEqual({
      externalSessionId: "native",
      runtimeKind: "codex",
      workingDirectory: "/repo",
    });
    expect(calls).toHaveLength(0);
    await harness.unmount();
  });

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
        workspaceId: "w",
        locationKey: "location-1",
        navigationType: "REPLACE",
        searchParams: new URLSearchParams("task=task-1&agent=build&autostart=1&start=now"),
        setSearchParams,
      });

      await harness.mount();
      expect(harness.getLatest().navigation).toMatchObject({
        taskId: "task-1",
        sessionExternalId: null,
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
      workspaceId: "w",
      locationKey: "location-1",
      navigationType: "REPLACE",
      searchParams: new URLSearchParams("task=task-1&agent=spec"),
      setSearchParams,
    });

    await harness.mount();
    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionExternalId: null,
      role: "spec",
    });
    expect(calls).toHaveLength(0);

    await harness.update({
      workspaceId: "w",
      locationKey: "location-2",
      navigationType: "POP",
      searchParams: new URLSearchParams("task=task-2&session=session-2&agent=planner"),
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-2",
      sessionExternalId: "session-2",
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
      workspaceId: "w",
      locationKey: "location-1",
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
      workspaceId: "w",
      locationKey: "location-2",
      navigationType: "REPLACE",
      searchParams: firstNext,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionExternalId: "session-1",
      role: "build",
    });
    expect(calls).toHaveLength(2);

    await harness.update({
      workspaceId: "w",
      locationKey: "location-3",
      navigationType: "REPLACE",
      searchParams: secondNext,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionExternalId: "session-1",
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
      workspaceId: "w",
      locationKey: "location-1",
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
      workspaceId: "w",
      locationKey: "location-2",
      navigationType: "POP",
      searchParams: previousUrl,
      setSearchParams,
    });

    expect(harness.getLatest().navigation).toMatchObject({
      taskId: "task-1",
      sessionExternalId: null,
      role: "build",
    });
    expect(calls).toHaveLength(2);

    await harness.unmount();
  });
});
