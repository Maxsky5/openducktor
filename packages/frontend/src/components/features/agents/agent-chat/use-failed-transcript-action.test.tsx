import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useFailedTranscriptAction } from "./use-failed-transcript-action";

type Input = Parameters<typeof useFailedTranscriptAction>[0];
const historyFailure = {
  code: "request_failed" as const,
  summary: "History failed",
  detail: "Read denied",
};
const input = (overrides: Partial<Input> = {}): Input => ({
  scopeKey: "/repo:task-1",
  identity: { runtimeKind: "opencode", externalSessionId: "native-1", workingDirectory: "/repo" },
  transcriptState: { kind: "failed", message: "Observation failed" },
  hasLoadedSession: false,
  observationFailed: true,
  loadHistory: mock(async () => null),
  reloadReadModel: mock(() => undefined),
  ...overrides,
});

test.each([
  {
    name: "missing observation",
    state: { kind: "failed", message: "Observation failed" },
    loaded: false,
    target: false,
    expected: "observation",
  },
  {
    name: "failed history",
    state: { kind: "failed", message: "History failed", historyFailure },
    loaded: true,
    target: false,
    expected: "history",
  },
  {
    name: "retained history",
    state: { kind: "visible", historyFailure },
    loaded: true,
    target: false,
    expected: "history",
  },
  {
    name: "target mismatch",
    state: { kind: "visible", historyFailure },
    loaded: true,
    target: true,
    expected: "observation",
  },
  {
    name: "healthy loaded session",
    state: { kind: "visible" },
    loaded: true,
    target: false,
    expected: null,
  },
] satisfies Array<{
  name: string;
  state: Input["transcriptState"];
  loaded: boolean;
  target: boolean;
  expected: string | null;
}>)("$name recovers only the failed source", async ({ state, loaded, target, expected }) => {
  const args = input({ transcriptState: state, hasLoadedSession: loaded, targetMismatch: target });
  const h = renderHook(() => useFailedTranscriptAction(args));
  try {
    if (expected === null) expect(h.result.current.action).toBeNull();
    else await act(async () => h.result.current.action?.onAction());
    expect(args.loadHistory).toHaveBeenCalledTimes(expected === "history" ? 1 : 0);
    expect(args.reloadReadModel).toHaveBeenCalledTimes(expected === "observation" ? 1 : 0);
  } finally {
    h.unmount();
  }
});

test("a rejected retry stays visible, succeeds on request, and ignores the prior conversation's result", async () => {
  let rejectOld = (_cause: Error) => {};
  const pending = new Promise<null>((_resolve, reject) => {
    rejectOld = reject;
  });
  const loadHistory = mock(() => pending);
  const args = input({
    transcriptState: { kind: "failed", message: "History failed", historyFailure },
    hasLoadedSession: true,
    loadHistory,
  });
  const h = renderHook((props: Input) => useFailedTranscriptAction(props), { initialProps: args });
  try {
    act(() => {
      h.result.current.action?.onAction();
      h.result.current.action?.onAction();
    });
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(h.result.current.action?.disabled).toBe(true);
    await act(async () => rejectOld(new Error("Retry denied")));
    expect(h.result.current.error).toBe("Retry denied");
    h.rerender({ ...args, transcriptState: { kind: "visible" } });
    expect(h.result.current.error).toBeNull();
    h.rerender(args);
    loadHistory.mockImplementation(async () => null);
    await act(async () => h.result.current.action?.onAction());
    expect(h.result.current.error).toBeNull();
    const delayed = new Promise<null>((_resolve, reject) => {
      rejectOld = reject;
    });
    loadHistory.mockImplementation(() => delayed);
    act(() => h.result.current.action?.onAction());
    h.rerender(
      input({
        scopeKey: "/other-repo:task-2",
        transcriptState: { kind: "visible" },
        hasLoadedSession: true,
      }),
    );
    await act(async () => rejectOld(new Error("Old conversation failed")));
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.action).toBeNull();
  } finally {
    h.unmount();
  }
});
