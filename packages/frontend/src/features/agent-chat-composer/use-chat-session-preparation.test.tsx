import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { applyAgentSessionLiveDelta } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/agent-session-live-projection";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useChatSessionPreparation } from "./use-chat-session-preparation";
import { SessionViewContext } from "@/features/session-navigation/session-view-context";

const identity: AgentSessionIdentity = {
  runtimeKind: "claude",
  workingDirectory: "/repo",
  externalSessionId: "session",
};

const setup = (livePresence: "present" | "unobserved" = "present") => {
  const store = createAgentSessionsStore("/repo");
  store.replaceSession(createAgentSessionFixture({ ...identity, livePresence }));
  const wrapper = ({ children }: PropsWithChildren) => (
    <AgentSessionsContext value={store}>{children}</AgentSessionsContext>
  );
  const remove = () =>
    store.setSessionCollection((current) =>
      applyAgentSessionLiveDelta({
        current,
        envelope: { type: "session_removed", ref: { repoPath: "/repo", ...identity } },
      }),
    );
  const attach = () =>
    store.updateSession(identity, (session) => ({ ...session, livePresence: "present" }));
  return { wrapper, remove, attach };
};

test("a hidden view waits to reopen a closed session and reuses a live preparation on return", async () => {
  const h = setup();
  let isActive = true;
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise));
  const wrapper = ({ children }: PropsWithChildren) => (
    <h.wrapper>
      <SessionViewContext value={{ id: "view", isActive }}>{children}</SessionViewContext>
    </h.wrapper>
  );
  const view = renderHook(
    () => useChatSessionPreparation({ identity, targetKey: "A", enabled: true, prepare }),
    { wrapper },
  );
  try {
    await act(async () => {});
    expect(view.result.current.ready).toBe(true);
    isActive = false;
    view.rerender();
    act(h.remove);
    expect(view.result.current.ready).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
    isActive = true;
    view.rerender();
    expect(view.result.current.ready).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(2);
    await act(async () => {
      h.attach();
      next.resolve();
    });
    expect(view.result.current.ready).toBe(true);
    isActive = false;
    view.rerender();
    isActive = true;
    view.rerender();
    expect(view.result.current.ready).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    next.resolve();
  }
});

test("preparation blocks submission until success and keeps a failed attempt visible", async () => {
  const { wrapper } = setup();
  const pending = Promise.withResolvers<void>();
  const prepare = mock(() => pending.promise);
  const view = renderHook(
    () => useChatSessionPreparation({ identity, targetKey: "A", enabled: true, prepare }),
    { wrapper },
  );
  try {
    expect(view.result.current).toEqual({ ready: false, error: null });
    await act(async () => pending.reject(new Error("Runtime could not attach")));
    expect(view.result.current).toEqual({ ready: false, error: "Runtime could not attach" });
    view.rerender();
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});

test("switching chats discards a late result from the old chat", async () => {
  const { wrapper } = setup();
  const old = Promise.withResolvers<void>();
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? old.promise : next.promise));
  const view = renderHook(
    ({ targetKey }) => useChatSessionPreparation({ identity, targetKey, enabled: true, prepare }),
    { initialProps: { targetKey: "A" }, wrapper },
  );
  try {
    view.rerender({ targetKey: "B" });
    await act(async () => old.resolve());
    expect(view.result.current.ready).toBe(false);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
  } finally {
    view.unmount();
  }
});

test("a new visit blocks the first render until the session is prepared again", async () => {
  const { wrapper } = setup();
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise));
  const states: boolean[] = [];
  const view = renderHook(
    ({ targetKey }) => {
      const result = useChatSessionPreparation({ identity, targetKey, enabled: true, prepare });
      states.push(result.ready);
      return result;
    },
    { initialProps: { targetKey: "A:1" }, wrapper },
  );
  try {
    await act(async () => {});
    expect(view.result.current.ready).toBe(true);
    states.length = 0;
    view.rerender({ targetKey: "A:2" });
    expect(states).not.toContain(true);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
  } finally {
    view.unmount();
  }
});

test("losing runtime readiness blocks Send and starts a fresh preparation after recovery", async () => {
  const { wrapper } = setup();
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise));
  const view = renderHook(
    ({ enabled }) => useChatSessionPreparation({ identity, targetKey: "A", enabled, prepare }),
    { initialProps: { enabled: true }, wrapper },
  );
  try {
    await act(async () => {});
    expect(view.result.current.ready).toBe(true);
    view.rerender({ enabled: false });
    expect(view.result.current.ready).toBe(false);
    view.rerender({ enabled: true });
    expect(view.result.current.ready).toBe(false);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
  }
});

test.each([true, false])(
  "owner removal prepares again before Send, success=%s",
  async (succeeds) => {
    const h = setup();
    const next = Promise.withResolvers<void>();
    const prepare = mock(() =>
      prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise,
    );
    const states: boolean[] = [];
    const view = renderHook(
      () => {
        const result = useChatSessionPreparation({
          identity,
          targetKey: "A",
          enabled: true,
          prepare,
        });
        states.push(result.ready);
        return result;
      },
      { wrapper: h.wrapper },
    );
    try {
      await act(async () => {});
      expect(view.result.current.ready).toBe(true);
      states.length = 0;
      act(h.remove);
      expect(states).not.toContain(true);
      expect(view.result.current.ready).toBe(false);
      expect(prepare).toHaveBeenCalledTimes(2);
      await act(async () => {
        if (succeeds) {
          h.attach();
          next.resolve();
        } else next.reject(new Error("Could not reopen the session"));
      });
      expect(view.result.current).toEqual({
        ready: succeeds,
        error: succeeds ? null : "Could not reopen the session",
      });
      view.rerender();
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  },
);

test("owner removal during preparation rejects a late success, including batched presence changes", async () => {
  const h = setup("unobserved");
  const pending = Promise.withResolvers<void>();
  const prepare = mock(() => pending.promise);
  const view = renderHook(
    () => useChatSessionPreparation({ identity, targetKey: "A", enabled: true, prepare }),
    { wrapper: h.wrapper },
  );
  try {
    act(() => {
      h.attach();
      h.remove();
    });
    await act(async () => pending.resolve());
    expect(view.result.current.ready).toBe(false);
    expect(view.result.current.error).toContain("closed during preparation");
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});

test.each([true, false])(
  "binding a closed session reports a failure, preparation settled=%s",
  async (settled) => {
    const h = setup();
    const pending = Promise.withResolvers<void>();
    const prepare = mock(() => pending.promise);
    const view = renderHook<
      ReturnType<typeof useChatSessionPreparation>,
      { identity: AgentSessionIdentity | null }
    >(
      ({ identity: target }) =>
        useChatSessionPreparation({ identity: target, targetKey: "draft", enabled: true, prepare }),
      { initialProps: { identity: null }, wrapper: h.wrapper },
    );
    try {
      act(h.remove);
      if (settled) await act(async () => pending.resolve());
      view.rerender({ identity });
      if (!settled) await act(async () => pending.resolve());
      expect(view.result.current.ready).toBe(false);
      expect(view.result.current.error).toContain("closed during preparation");
      view.rerender({ identity });
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  },
);
