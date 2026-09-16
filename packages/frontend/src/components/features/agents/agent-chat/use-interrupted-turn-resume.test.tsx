import { expect, test } from "bun:test";
import { HostInvokeError } from "@openducktor/host-client";
import { act, renderHook } from "@testing-library/react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useInterruptedTurnResume } from "./use-interrupted-turn-resume";

const identityA: AgentSessionIdentity = {
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-a",
};
const identityB: AgentSessionIdentity = {
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-b",
};
const keyA = agentSessionIdentityKey(identityA);
const keyB = agentSessionIdentityKey(identityB);

type PendingResume = {
  readonly identity: AgentSessionIdentity;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
};

const NO_SELECTION = { sessionKey: null, isLatestTurnSettled: false } as const;

const unconfirmedContinuationFailure = () =>
  new HostInvokeError("Continuation unconfirmed", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "runtime_unavailable",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-a",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "The runtime did not confirm the continuation.",
      nextAction: "Inspect the runtime and this session.",
    },
  });

const createResumeRecorder = () => {
  const pending: PendingResume[] = [];
  const continueInterruptedTurn = (identity: AgentSessionIdentity): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      pending.push({ identity, resolve, reject });
    });
  return { pending, continueInterruptedTurn };
};

test("keys the loading and failure state to the session that started the resume", async () => {
  const { pending, continueInterruptedTurn } = createResumeRecorder();
  const view = renderHook(() => useInterruptedTurnResume(continueInterruptedTurn, NO_SELECTION));

  try {
    act(() => {
      view.result.current.resume(identityA);
    });

    expect(view.result.current.isSessionResuming(keyA)).toBe(true);
    expect(view.result.current.isSessionResuming(keyB)).toBe(false);

    await act(async () => {
      pending[0]?.reject(new Error("connection lost"));
    });

    expect(view.result.current.isSessionResuming(keyA)).toBe(false);
    expect(view.result.current.resumeErrorForSession(keyA)).toBe("connection lost");
    expect(view.result.current.resumeErrorForSession(keyB)).toBeNull();
  } finally {
    view.unmount();
  }
});

test("does not start a second resume for the same session while it is pending", () => {
  const { pending, continueInterruptedTurn } = createResumeRecorder();
  const view = renderHook(() => useInterruptedTurnResume(continueInterruptedTurn, NO_SELECTION));

  try {
    act(() => {
      view.result.current.resume(identityA);
      view.result.current.resume(identityA);
    });

    expect(pending).toHaveLength(1);
    expect(view.result.current.isSessionResuming(keyA)).toBe(true);
  } finally {
    view.unmount();
  }
});

test("keeps a pending resume of another session independent", async () => {
  const { pending, continueInterruptedTurn } = createResumeRecorder();
  const view = renderHook(() => useInterruptedTurnResume(continueInterruptedTurn, NO_SELECTION));
  const failure = new HostInvokeError("Continuation refused", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "completed_turn",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-a",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "OpenCode session 'session-a' has a completed latest turn.",
      nextAction: "Send a new message to start new work.",
    },
  });

  try {
    act(() => {
      view.result.current.resume(identityA);
      view.result.current.resume(identityB);
    });

    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[0]?.reject(failure);
    });

    expect(view.result.current.isSessionResuming(keyA)).toBe(false);
    expect(view.result.current.isSessionResuming(keyB)).toBe(true);
    expect(view.result.current.resumeErrorForSession(keyA)).toBe(
      "OpenCode session 'session-a' has a completed latest turn. Send a new message to start new work.",
    );
    expect(view.result.current.resumeErrorForSession(keyB)).toBeNull();
    expect(view.result.current.persistentResumeErrorForSession(keyA)).toBeNull();

    await act(async () => {
      pending[1]?.resolve();
    });

    expect(view.result.current.isSessionResuming(keyB)).toBe(false);
  } finally {
    view.unmount();
  }
});

test("keeps an unconfirmed continuation failure after the Resume action settles", async () => {
  const { pending, continueInterruptedTurn } = createResumeRecorder();
  const view = renderHook(() => useInterruptedTurnResume(continueInterruptedTurn, NO_SELECTION));
  const failure = unconfirmedContinuationFailure();

  try {
    act(() => {
      view.result.current.resume(identityA);
    });

    await act(async () => {
      pending[0]?.reject(failure);
    });

    expect(view.result.current.resumeErrorForSession(keyA)).toBe(
      "The runtime did not confirm the continuation. Inspect the runtime and this session.",
    );
    expect(view.result.current.persistentResumeErrorForSession(keyA)).toBe(
      "The runtime did not confirm the continuation. Inspect the runtime and this session.",
    );
    expect(view.result.current.persistentResumeErrorForSession(keyB)).toBeNull();

    act(() => {
      view.result.current.resume(identityA);
    });

    expect(view.result.current.persistentResumeErrorForSession(keyA)).toBeNull();

    await act(async () => {
      pending[1]?.resolve();
    });
  } finally {
    view.unmount();
  }
});

test("clears an unconfirmed continuation failure when the latest turn settles", async () => {
  const { pending, continueInterruptedTurn } = createResumeRecorder();
  let isLatestTurnSettled = false;
  const view = renderHook(() =>
    useInterruptedTurnResume(continueInterruptedTurn, { sessionKey: keyA, isLatestTurnSettled }),
  );

  try {
    act(() => {
      view.result.current.resume(identityA);
    });

    await act(async () => {
      pending[0]?.reject(unconfirmedContinuationFailure());
    });

    expect(view.result.current.persistentResumeErrorForSession(keyA)).toBe(
      "The runtime did not confirm the continuation. Inspect the runtime and this session.",
    );

    isLatestTurnSettled = true;
    await act(async () => {
      view.rerender();
    });

    expect(view.result.current.resumeErrorForSession(keyA)).toBeNull();
    expect(view.result.current.persistentResumeErrorForSession(keyA)).toBeNull();
  } finally {
    view.unmount();
  }
});
