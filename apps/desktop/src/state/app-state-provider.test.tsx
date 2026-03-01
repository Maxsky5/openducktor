import { describe, expect, test } from "bun:test";
import { Component, createElement, type ReactElement, type ReactNode } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  useAgentState,
  useChecksState,
  useDelegationState,
  useSpecState,
  useTasksState,
  useWorkspaceState,
} from "./app-state-provider";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public render(): ReactNode {
    if (this.state.error) {
      return null;
    }
    return this.props.children;
  }
}

const HookProbe = ({ hook }: { hook: () => unknown }): ReactElement => {
  hook();
  return createElement("div");
};

const captureHookErrorMessage = (hook: () => unknown): string | null => {
  let renderer!: TestRenderer.ReactTestRenderer;

  act(() => {
    renderer = TestRenderer.create(
      createElement(ErrorBoundary, null, createElement(HookProbe, { hook })),
    );
  });

  const boundary = renderer.root.findByType(ErrorBoundary).instance as ErrorBoundary;
  const message = boundary.state.error?.message ?? null;
  renderer.unmount();
  return message;
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
