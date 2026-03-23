import { beforeAll, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { PendingGitConflictResolutionRequest } from "./use-git-conflict-resolution";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    [key: string]: unknown;
  }): ReactElement | null => (open === false ? null : createElement("div", null, children)),
  DialogBody: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("div", null, children),
  DialogContent: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("div", null, children),
  DialogDescription: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("p", null, children),
  DialogFooter: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("h2", null, children),
}));

let GitConflictResolutionModal: typeof import("./git-conflict-resolution-modal").GitConflictResolutionModal;

const builderSession = (sessionId: string): AgentSessionState => ({
  sessionId,
  externalSessionId: `external-${sessionId}`,
  taskId: "task-1",
  runtimeKind: "opencode",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-18T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

const conflictFixture: GitConflict = {
  operation: "rebase",
  currentBranch: "feature/test",
  targetBranch: "main",
  conflictedFiles: ["src/example.ts"],
  output: "CONFLICT",
  workingDir: "/tmp/repo/worktree",
};

const createRequest = (
  overrides: Partial<PendingGitConflictResolutionRequest> = {},
): PendingGitConflictResolutionRequest => ({
  requestId: "request-1",
  conflict: conflictFixture,
  currentWorktreePath: "/tmp/repo/worktree",
  currentViewSessionId: "session-1",
  defaultMode: "existing",
  defaultSessionId: "session-1",
  builderSessions: [builderSession("session-1"), builderSession("session-2")],
  ...overrides,
});

beforeAll(async () => {
  ({ GitConflictResolutionModal } = await import("./git-conflict-resolution-modal"));
});

const renderModal = (request: PendingGitConflictResolutionRequest, onResolve: () => void) =>
  render(
    createElement(GitConflictResolutionModal, {
      request,
      onResolve,
    }),
  );

describe("GitConflictResolutionModal render behavior", () => {
  test("submits the selected existing session", async () => {
    const onResolve = mock(() => {});
    const rendered = renderModal(createRequest(), onResolve);

    const existingSessionButtons = screen
      .getAllByRole("button")
      .filter(
        (button) =>
          button.textContent?.includes("idle") && !button.textContent?.includes("paused worktree"),
      );

    const sessionButton = existingSessionButtons[1];
    if (!sessionButton) {
      throw new Error("Expected a second existing-session button");
    }

    fireEvent.click(sessionButton);

    const confirmButton = screen.getByRole("button", { name: /use selected session/i });

    expect(confirmButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(confirmButton);

    expect(onResolve).toHaveBeenCalledWith({ mode: "existing", sessionId: "session-2" });
    rendered.unmount();
  });

  test("submits a new session decision", async () => {
    const onResolve = mock(() => {});
    const rendered = renderModal(createRequest(), onResolve);

    fireEvent.click(
      screen.getByRole("button", {
        name: /start a new builder session in the paused worktree/i,
      }),
    );

    const confirmButton = screen.getByRole("button", { name: /start new session/i });

    expect(confirmButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(confirmButton);

    expect(onResolve).toHaveBeenCalledWith({ mode: "new" });
    rendered.unmount();
  });
});
