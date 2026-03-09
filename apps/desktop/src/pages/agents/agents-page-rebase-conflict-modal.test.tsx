import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createAgentSessionFixture, enableReactActEnvironment } from "./agent-studio-test-utils";
import type { PendingRebaseConflictResolutionRequest } from "./use-agent-studio-rebase-conflict-resolution";

enableReactActEnvironment();

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog", undefined, children),
  DialogContent: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog-content", undefined, children),
  DialogDescription: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog-description", undefined, children),
  DialogFooter: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog-footer", undefined, children),
  DialogHeader: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog-header", undefined, children),
  DialogTitle: ({ children }: { children: ReactNode }): ReactElement =>
    createElement("mock-dialog-title", undefined, children),
}));

type RebaseConflictResolutionModalComponent =
  typeof import("./agents-page-rebase-conflict-modal")["RebaseConflictResolutionModal"];

let RebaseConflictResolutionModal: RebaseConflictResolutionModalComponent;

const builderSession = createAgentSessionFixture({
  runtimeKind: "opencode",
  sessionId: "build-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
});

const createRequest = (requestId: string): PendingRebaseConflictResolutionRequest => ({
  requestId,
  conflict: {
    operation: "rebase",
    currentBranch: "feature/task-1",
    targetBranch: "origin/main",
    conflictedFiles: ["src/conflict.ts"],
    output: "CONFLICT (content): Merge conflict in src/conflict.ts",
    workingDir: "/repo/worktrees/task-1",
  },
  builderSessions: [builderSession],
  currentWorktreePath: "/repo/worktrees/task-1",
  currentViewSessionId: null,
  defaultMode: "existing",
  defaultSessionId: "build-1",
});

const readNodeText = (value: ReactNode): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => readNodeText(entry)).join("");
  }
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  return String(value);
};

beforeAll(async () => {
  ({ RebaseConflictResolutionModal } = await import("./agents-page-rebase-conflict-modal"));
});

describe("RebaseConflictResolutionModal", () => {
  test("resets local mode when a new request replaces the current one", async () => {
    const onResolve = mock(() => {});
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(RebaseConflictResolutionModal, {
          request: createRequest("rebase-conflict-0"),
          onResolve,
        }),
      );
    });

    try {
      const newSessionButton = renderer.root.findByProps({
        "data-testid": "agent-studio-rebase-conflict-new-session-option",
      });
      await act(async () => {
        newSessionButton.props.onClick();
      });

      const confirmButtonAfterToggle = renderer.root.findByProps({
        "data-testid": "agent-studio-rebase-conflict-confirm-button",
      });
      expect(readNodeText(confirmButtonAfterToggle.props.children)).toBe("Start new session");

      await act(async () => {
        renderer.update(
          createElement(RebaseConflictResolutionModal, {
            request: createRequest("rebase-conflict-1"),
            onResolve,
          }),
        );
      });

      const confirmButtonAfterReplacement = renderer.root.findByProps({
        "data-testid": "agent-studio-rebase-conflict-confirm-button",
      });
      expect(readNodeText(confirmButtonAfterReplacement.props.children)).toBe(
        "Use selected session",
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});
