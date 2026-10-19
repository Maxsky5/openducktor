import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import type { NavigateOptions, SetURLSearchParams } from "react-router";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";

type Route = Omit<
  Parameters<typeof useWorkspaceSessionNavigation>[0],
  "setSearchParams" | "workspaceId" | "enabled"
> & { enabled?: boolean };

function createHarness(search = "session=First&keep=value") {
  const writes: Array<{ search: string; options: NavigateOptions | undefined }> = [];
  const events: string[] = [];
  const setSearchParams: SetURLSearchParams = (next, options) => {
    if (!(next instanceof URLSearchParams)) throw new Error("Expected complete search params");
    writes.push({ search: next.toString(), options });
    events.push(`write:${next.get("session")}`);
  };
  const initialProps: Route = {
    searchParams: new URLSearchParams(search),
    locationKey: "initial",
    navigationType: "POP",
  };
  const hook = renderHook(
    (route: Route) => {
      const workspaceId = route.searchParams.get("workspace") ?? "workspace-a";
      const navigation = useWorkspaceSessionNavigation({
        enabled: true,
        ...route,
        workspaceId,
        setSearchParams,
      });
      useLayoutEffect(() => {
        events.push(`selected:${navigation.sessionId}`);
      }, [navigation.sessionId, workspaceId]);
      return navigation;
    },
    { initialProps, wrapper: ({ children }) => <StrictMode>{children}</StrictMode> },
  );
  return { ...hook, writes, events };
}

test("keeps the displayed owner until the router commits the requested URL", () => {
  const h = createHarness();
  try {
    h.events.length = 0;
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }, false));
    expect(h.events).toEqual(["write:Second"]);
    expect(h.result.current.sessionId).toBe("First");
    expect(h.writes).toEqual([
      {
        search: "session=Second&keep=value",
        options: { replace: false, preventScrollReset: true },
      },
    ]);
    act(() => h.result.current.updateNavigation({ sessionId: "Third" }, false));
    expect(h.result.current.sessionId).toBe("First");
    expect(h.writes).toHaveLength(2);

    h.rerender({
      searchParams: new URLSearchParams(h.writes[0]?.search),
      locationKey: "old-echo",
      navigationType: "PUSH",
    });
    expect(h.result.current.sessionId).toBe("Second");
    h.rerender({
      searchParams: new URLSearchParams(h.writes[1]?.search),
      locationKey: "latest-echo",
      navigationType: "PUSH",
    });
    expect(h.result.current.sessionId).toBe("Third");
    expect(h.writes).toHaveLength(2);
  } finally {
    h.unmount();
  }
});

test("coalesces rapid updates and preserves the creation flag and unrelated params", () => {
  const h = createHarness();
  try {
    act(() => {
      h.result.current.updateNavigation({ sessionId: "Second" }, false);
      h.result.current.updateNavigation({ sessionId: "Third" }, false);
      h.result.current.updateNavigation({ creating: true });
    });
    expect(h.result.current.sessionId).toBe("First");
    expect(h.result.current.creating).toBe(true);
    expect(h.writes).toEqual([
      {
        search: "session=Third&keep=value&create=session",
        options: { replace: true, preventScrollReset: true },
      },
    ]);
    act(() => h.result.current.updateNavigation({ sessionId: "New chat", creating: false }));
    expect(h.writes[1]?.search).toBe("session=New+chat&keep=value");
    expect(h.result.current.sessionId).toBe("First");
    expect(h.result.current.creating).toBe(false);
    act(() => h.result.current.updateNavigation({ sessionId: "New chat", creating: false }));
    expect(h.writes).toHaveLength(2);
  } finally {
    h.unmount();
  }
});

test("a latest URL acknowledgement retires skipped intermediate writes", () => {
  const h = createHarness();
  try {
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }, false));
    act(() => h.result.current.updateNavigation({ sessionId: "Third" }, false));
    h.rerender({
      searchParams: new URLSearchParams("session=Third&keep=value"),
      locationKey: "latest-echo",
      navigationType: "PUSH",
    });
    h.rerender({
      searchParams: new URLSearchParams("session=Second&keep=value"),
      locationKey: "external-link",
      navigationType: "PUSH",
    });
    expect(h.result.current.sessionId).toBe("Second");
    expect(h.writes).toHaveLength(2);
  } finally {
    h.unmount();
  }
});

test("Back wins over a pending own write without writing the old selection back", () => {
  const h = createHarness();
  try {
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }, false));
    act(() => h.result.current.updateNavigation({ sessionId: "Third" }, false));
    h.rerender({
      searchParams: new URLSearchParams("session=Second&keep=value"),
      locationKey: "back",
      navigationType: "POP",
    });
    expect(h.result.current.sessionId).toBe("Second");
    expect(h.writes).toHaveLength(2);
    act(() => h.result.current.updateNavigation({ sessionId: "Fourth" }, false));
    expect(h.writes[2]?.search).toBe("session=Fourth&keep=value");
  } finally {
    h.unmount();
  }
});

test("a fresh same-URL link overrides local selection and preserves new external params", () => {
  const h = createHarness();
  try {
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }, false));
    h.rerender({
      searchParams: new URLSearchParams("session=First&keep=value"),
      locationKey: "same-url-link",
      navigationType: "PUSH",
    });
    expect(h.result.current.sessionId).toBe("First");
    expect(h.writes).toHaveLength(1);
    h.rerender({
      searchParams: new URLSearchParams("session=First&keep=changed"),
      locationKey: "external-param",
      navigationType: "REPLACE",
    });
    act(() => h.result.current.updateNavigation({ sessionId: "Third" }, false));
    expect(h.writes[1]?.search).toBe("session=Third&keep=changed");
  } finally {
    h.unmount();
  }
});

test("clearing selection removes only the session param and retains the explicit empty selection", () => {
  const h = createHarness();
  try {
    act(() => h.result.current.updateNavigation({ sessionId: null }));
    expect(h.writes).toEqual([
      { search: "keep=value", options: { replace: true, preventScrollReset: true } },
    ]);
    h.rerender({
      searchParams: new URLSearchParams("keep=value"),
      locationKey: "archive",
      navigationType: "REPLACE",
    });
    expect(h.result.current.sessionId).toBeNull();
    expect(h.writes).toHaveLength(1);
  } finally {
    h.unmount();
  }
});

test("a workspace switch commits the requested chat without writing the old workspace's selection", () => {
  const h = createHarness("workspace=workspace-a&session=First");
  try {
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }, false));
    h.events.length = 0;
    h.rerender({
      searchParams: new URLSearchParams("workspace=workspace-b&session=Other"),
      locationKey: "other-workspace",
      navigationType: "PUSH",
    });
    expect(h.result.current.sessionId).toBe("Other");
    expect(h.events).toEqual(["selected:Other"]);
    expect(h.writes).toHaveLength(1);
    act(() => h.result.current.updateNavigation({ sessionId: "Next" }));
    expect(h.writes[1]?.search).toBe("workspace=workspace-b&session=Next");
  } finally {
    h.unmount();
  }
});

test("a retained view cannot write its selection while the workspace route is pending", () => {
  const h = createHarness("workspace=workspace-a&session=First");
  try {
    h.rerender({
      searchParams: new URLSearchParams("workspace=workspace-a&session=First"),
      locationKey: "initial",
      navigationType: "POP",
      enabled: false,
    });
    act(() => h.result.current.updateNavigation({ sessionId: "Second" }));
    expect(h.writes).toHaveLength(0);
    h.rerender({
      searchParams: new URLSearchParams("workspace=workspace-b&session=Other"),
      locationKey: "other",
      navigationType: "PUSH",
      enabled: true,
    });
    expect(h.result.current.sessionId).toBe("Other");
    expect(h.writes).toHaveLength(0);
    act(() => h.result.current.updateNavigation({ sessionId: "Next" }));
    expect(h.writes[0]?.search).toBe("workspace=workspace-b&session=Next");
  } finally {
    h.unmount();
  }
});

test("a hidden chat drops its outbound request and ignores callbacks from its last visit", () => {
  const h = createHarness();
  const route: Route = {
    searchParams: new URLSearchParams("session=First&keep=value"),
    locationKey: "initial",
    navigationType: "POP",
  };
  try {
    const update = h.result.current.updateNavigation;
    act(() => update({ sessionId: "Second" }));
    expect(h.writes).toHaveLength(1);
    h.rerender({ ...route, enabled: false });
    act(() => update({ sessionId: "Third" }));
    h.rerender({ ...route, enabled: true });
    expect(h.result.current.sessionId).toBe("First");
    expect(h.writes).toHaveLength(1);
    act(() => h.result.current.updateNavigation({ creating: true }));
    expect(h.writes.at(-1)?.search).toBe("session=First&keep=value&create=session");
  } finally {
    h.unmount();
  }
});
