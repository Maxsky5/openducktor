import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  useAgentState,
  useChecksState,
  useDelegationState,
  useSpecState,
  useTasksState,
  useWorkspaceState,
} from "./app-state-provider";

const HookProbe = ({ hook }: { hook: () => unknown }): ReactElement => {
  hook();
  return createElement("div");
};

const captureHookErrorMessage = (hook: () => unknown): string | null => {
  try {
    renderToStaticMarkup(createElement(HookProbe, { hook }));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("AppStateProvider hooks", () => {
  test("throw clear errors when used outside AppStateProvider", () => {
    const expectations: Array<{ hook: () => unknown; expected: string }> = [
      {
        hook: useWorkspaceState,
        expected: "useWorkspaceState must be used inside AppStateProvider",
      },
      {
        hook: useChecksState,
        expected: "useChecksState must be used inside AppStateProvider",
      },
      {
        hook: useTasksState,
        expected: "useTasksState must be used inside AppStateProvider",
      },
      {
        hook: useDelegationState,
        expected: "useDelegationState must be used inside AppStateProvider",
      },
      {
        hook: useSpecState,
        expected: "useSpecState must be used inside AppStateProvider",
      },
      {
        hook: useAgentState,
        expected: "useAgentState must be used inside AppStateProvider",
      },
    ];

    for (const { hook, expected } of expectations) {
      expect(captureHookErrorMessage(hook)).toBe(expected);
    }
  });
});
