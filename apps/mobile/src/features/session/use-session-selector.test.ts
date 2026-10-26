import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentSessionFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { shallowEqual, useSessionSelector } from "./use-session-selector";

type Slice = { status: AgentSessionState["status"] | null } | { title: string | null };
type Select = (session: AgentSessionState | null) => Slice;

const selectStatus: Select = (session) => ({ status: session?.status ?? null });
const selectTitle: Select = (session) => ({ title: session?.title ?? null });

const setup = () => {
  const session = createAgentSessionFixture({
    externalSessionId: "session-1",
    status: "running",
    title: "Build the app",
  });
  const identity = {
    externalSessionId: session.externalSessionId,
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
  };
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(session);
  const view = renderHook<Slice, { select: Select }>(
    ({ select }) => useSessionSelector(identity, select),
    {
      initialProps: { select: selectStatus },
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(AgentSessionsContext.Provider, { value: store }, children),
    },
  );
  return { session, store, view };
};

describe("useSessionSelector", () => {
  test("keeps the same slice object while a session change leaves the slice equal", () => {
    const { session, store, view } = setup();
    const first = view.result.current;
    expect(first).toEqual({ status: "running" });
    act(() => store.replaceSession({ ...session, title: "A new title" }));
    expect(view.result.current).toBe(first);
    act(() => store.replaceSession({ ...session, status: "idle" }));
    expect(view.result.current).toEqual({ status: "idle" });
  });

  test("reads the session again for a new select", () => {
    const { view } = setup();
    view.rerender({ select: selectTitle });
    expect(view.result.current).toEqual({ title: "Build the app" });
  });
});

describe("shallowEqual", () => {
  test("compares the keys and values of plain objects", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual<object>({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: { nested: 1 } }, { a: { nested: 1 } })).toBe(false);
  });

  test("tells arrays from objects and handles null", () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual<object>([1], { 0: 1 })).toBe(false);
    expect(shallowEqual<object | null>(null, {})).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
  });
});
