import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import type { GitConflict } from "@/features/agent-studio-git";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { PendingGitConflictResolutionRequest } from "./use-git-conflict-resolution";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("div", {}, children),
  DialogContent: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("div", {}, children),
  DialogDescription: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("p", {}, children),
  DialogFooter: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("div", {}, children),
  DialogHeader: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("div", {}, children),
  DialogTitle: ({ children }: { children?: ReactNode }): ReactElement =>
    createElement("h2", {}, children),
}));

let GitConflictResolutionModal: typeof import("./git-conflict-resolution-modal").GitConflictResolutionModal;

const flattenChildrenText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(flattenChildrenText).join(" ");
  }
  if (value && typeof value === "object" && "props" in value) {
    return flattenChildrenText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
};

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

const renderModal = async (
  request: PendingGitConflictResolutionRequest,
  onResolve: () => void,
): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      createElement(GitConflictResolutionModal, {
        request,
        onResolve,
      }),
    );
  });
  return renderer;
};

describe("GitConflictResolutionModal render behavior", () => {
  test("submits the selected existing session", async () => {
    const onResolve = mock(() => {});
    const mountedRenderer = await renderModal(createRequest(), onResolve);

    const existingSessionButtons = mountedRenderer.root.findAll(
      (node: ReactTestInstance) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("idle") &&
        !flattenChildrenText(node.props.children).includes("paused worktree"),
    );

    const sessionButton = existingSessionButtons[1];
    if (!sessionButton) {
      throw new Error("Expected a second existing-session button");
    }

    await act(async () => {
      sessionButton.props.onClick();
    });

    const confirmButton = mountedRenderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("Use selected session"),
    );

    expect(confirmButton.props.disabled).toBe(false);

    await act(async () => {
      confirmButton.props.onClick();
    });

    expect(onResolve).toHaveBeenCalledWith({ mode: "existing", sessionId: "session-2" });
  });

  test("submits a new session decision", async () => {
    const onResolve = mock(() => {});
    const mountedRenderer = await renderModal(createRequest(), onResolve);

    const newSessionButton = mountedRenderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes(
          "Start a new Builder session in the paused worktree",
        ),
    );

    await act(async () => {
      newSessionButton.props.onClick();
    });

    const confirmButton = mountedRenderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("Start new session"),
    );

    expect(confirmButton.props.disabled).toBe(false);

    await act(async () => {
      confirmButton.props.onClick();
    });

    expect(onResolve).toHaveBeenCalledWith({ mode: "new" });
  });
});
