import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  useChecksState,
  useDelegationState,
  useSpecState,
  useTasksState,
} from "./app-state-provider";
import { useWorkspaceState } from "./index";

const HookProbe = ({ hook }: { hook: () => void }): ReactElement => {
  hook();
  return createElement("div");
};

const captureHookErrorMessage = (hook: () => void): string | null => {
  try {
    renderToStaticMarkup(createElement(HookProbe, { hook }));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("AppStateProvider hooks", () => {
  test("throw clear errors when used outside AppStateProvider", () => {
    const expectations: Array<{ hook: () => void; expected: string }> = [
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
    ];

    for (const { hook, expected } of expectations) {
      expect(captureHookErrorMessage(hook)).toBe(expected);
    }
  });
});
