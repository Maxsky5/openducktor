import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { type ComponentProps, type PropsWithChildren, isValidElement } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { WorkspaceSessionForkDialog } from "./workspace-session-fork-dialog";
import { useWorkspaceSessionFork } from "./use-workspace-session-fork";

const source: WorkspaceSession = {
  id: "source",
  runtimeKind: "codex",
  externalSessionId: "native-source",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  manualTitle: "Source",
  targetBranch: null,
  generatedTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

const dialogProps = (dialog: ReturnType<typeof useWorkspaceSessionFork>["dialog"]) => {
  if (!isValidElement<ComponentProps<typeof WorkspaceSessionForkDialog>>(dialog))
    throw new Error("Expected the fork dialog");
  return dialog.props;
};

test("closes the committed workspace fork dialog before navigation lets the child composer take focus", () => {
  const store = createAgentSessionsStore("/repo");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider>
      <AgentSessionsContext value={store}>
        <MemoryRouter initialEntries={["/sessions?session=source"]}>{children}</MemoryRouter>
      </AgentSessionsContext>
    </QueryProvider>
  );
  const view = renderHook(
    () => {
      const location = useLocation();
      const fork = useWorkspaceSessionFork({
        workspace: { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" },
        record: source,
        visible: true,
        disabledReason: null,
      });
      return { fork, address: `${location.pathname}${location.search}` };
    },
    { wrapper },
  );
  try {
    act(() => {
      view.result.current.fork.actions?.onFork({ messageId: "reply" });
    });
    act(() => {
      dialogProps(view.result.current.fork.dialog).onForked({
        ...source,
        id: "child",
        externalSessionId: "native-child",
      });
    });
    expect(dialogProps(view.result.current.fork.dialog).open).toBe(false);
    expect(view.result.current.address).toBe("/sessions?session=source");
    const closeFocus = new Event("close", { cancelable: true });
    act(() => {
      dialogProps(view.result.current.fork.dialog).onCloseAutoFocus?.(closeFocus);
    });
    expect(closeFocus.defaultPrevented).toBe(true);
    expect(view.result.current.address).toBe(
      "/sessions?workspace=workspace&kind=workspace&session=child",
    );
  } finally {
    view.unmount();
  }
});
