import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { TerminalSessionTransport } from "./terminal-session";
import { type TerminalSessionHandlers, useTerminalSession } from "./use-terminal-session";

const handlers: TerminalSessionHandlers = {
  onLifecycle: () => {},
  onTitle: () => {},
  onForgotten: () => {},
  onCopy: () => {},
  onLink: () => {},
  onModifiersConsumed: () => {},
};

const createTransport = () => {
  const calls: string[] = [];
  const transport: TerminalSessionTransport = {
    subscribe: (terminalId) => {
      calls.push(`subscribe:${terminalId}`);
      return () => calls.push(`unsubscribe:${terminalId}`);
    },
    acknowledge: async () => {},
    write: async () => {},
    resize: async () => {},
    releaseEmulator: (terminalId) => {
      calls.push(`release:${terminalId}`);
    },
  };
  return { calls, transport };
};

describe("useTerminalSession", () => {
  test("detaches a blurred view and starts a new session when the view has focus again", () => {
    const { calls, transport } = createTransport();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useTerminalSession({
          controller: transport,
          terminalId: "terminal-1",
          active,
          commandsOpen: true,
          handlers,
        }),
      { initialProps: { active: true } },
    );
    const first = result.current;
    expect(first.session).not.toBeNull();
    act(() => first.session?.attachPage(() => {}, 80, 24));
    expect(calls).toEqual(["subscribe:terminal-1"]);

    rerender({ active: false });
    expect(result.current.session).toBeNull();
    // The transport forgets the parsed screen, so the next attach gets the full screen.
    expect(calls).toEqual(["subscribe:terminal-1", "release:terminal-1", "unsubscribe:terminal-1"]);

    rerender({ active: true });
    expect(result.current.session).not.toBeNull();
    expect(result.current.session).not.toBe(first.session);
    expect(result.current.generation).toBe(first.generation + 1);
  });

  test("starts no session while the view is not active", () => {
    const { calls, transport } = createTransport();
    const { result } = renderHook(() =>
      useTerminalSession({
        controller: transport,
        terminalId: "terminal-1",
        active: false,
        commandsOpen: true,
        handlers,
      }),
    );
    expect(result.current.session).toBeNull();
    expect(calls).toEqual([]);
  });
});
