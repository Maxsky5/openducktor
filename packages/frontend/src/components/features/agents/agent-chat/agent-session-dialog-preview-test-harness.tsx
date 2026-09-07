import { mock, spyOn } from "bun:test";
import { File } from "@pierre/diffs";
import type { HostClient } from "@openducktor/host-client";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  useEffect,
  useRef,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import * as workers from "@/contexts/DiffWorkerProvider";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import {
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentOperationsContext,
  AgentSessionsContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createAgentSessionFixture,
  createRepoRuntimeHealthFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import * as pierre from "../task-execution-file-preview-pierre";
import { buildMessage } from "./agent-chat-test-fixtures";
import { useAgentSessionTranscriptDialog } from "./agent-session-transcript-dialog-context";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import { AgentSessionTranscriptDialogHost } from "./use-agent-session-transcript-dialog";

enableReactActEnvironment();

/** Use the real dialog, transcript, controller, Query reader, and editor state. Mock shell I/O and Pierre's DOM renderer. */
export function createDialogPreviewHarness(fileLink = "src/file.ts", children?: ReactNode) {
  const frames = createAnimationFrameTestDriver();
  frames.install();
  const client = createQueryClient();
  client.setQueryData(settingsSnapshotQueryOptions().queryKey, createSettingsSnapshotFixture());
  for (const taskId of ["a", "b"])
    client.setQueryData(taskWorktreeQueryOptions({ repoPath: "/repo", taskId }).queryKey, () => ({
      workingDirectory: `/repo/${taskId}`,
    }));
  const sessions = createAgentSessionsStore("/repo");
  for (const target of Object.values(dialogTargets)) {
    sessions.replaceSession(
      createAgentSessionFixture({
        ...target,
        sessionAssociation: target.sessionScope,
        historyLoadState: "loaded",
        status: target.externalSessionId === "main" ? "running" : "idle",
        messages: createSessionMessagesState(target.externalSessionId, [
          buildMessage(
            "assistant",
            `${target.externalSessionId} conversation. [Open file](${fileLink})`,
            { id: `${target.externalSessionId}-message` },
          ),
        ]),
      }),
    );
  }
  const read = mock<HostClient["filesystemReadTextFile"]>(async ({ rootPath }) =>
    dialogTextFile(rootPath),
  );
  const write = mock<HostClient["filesystemWriteTextFile"]>(async ({ rootPath, contents }) =>
    dialogTextFile(rootPath, contents),
  );
  const canonicalize = mock<HostClient["gitCanonicalizePath"]>(async (path) => path);
  const previousBridge = getShellBridge();
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        filesystemReadTextFile: read,
        filesystemWriteTextFile: write,
        gitCanonicalizePath: canonicalize,
      },
    }),
  );
  let createEditor: Parameters<typeof pierre.EditProvider>[0]["createEditor"];
  const spies = [
    spyOn(workers, "DiffWorkerProvider").mockImplementation(({ children }) => <>{children}</>),
    spyOn(pierre, "EditProvider").mockImplementation((props) => {
      createEditor = props.createEditor;
      return <>{props.children}</>;
    }),
    spyOn(pierre, "CodeView").mockImplementation(function TestCodeView(props): ReactElement {
      const input = useRef<HTMLTextAreaElement>(null);
      useEffect(() => {
        if (!props.editorOptions) return;
        const editor = createEditor(props.editorOptions);
        const focus = spyOn(editor, "focus").mockImplementation(() => input.current?.focus());
        props.editorOptions.onAttach?.(editor, new File());
        return () => focus.mockRestore();
      }, [props.editorOptions]);
      const item = props.items[0];
      if (!item) throw new Error("Expected a file in the editor.");
      return (
        <textarea
          key={`${item.id}:${item.version}`}
          ref={input}
          aria-label="Code editor"
          defaultValue={item.file.contents}
          onChange={(event) =>
            props.onItemEditChange?.(item, { ...item.file, contents: event.target.value })
          }
        />
      );
    }),
  ];
  let actions: ReturnType<typeof useAgentSessionTranscriptDialog>;
  function CaptureActions() {
    actions = useAgentSessionTranscriptDialog();
    return null;
  }
  const definitions = createRuntimeDefinitionsContextValue({
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
  });
  const health = createRepoRuntimeHealthContextValue({
    runtimeHealthByRuntime: {
      opencode: createRepoRuntimeHealthFixture(),
      codex: createRepoRuntimeHealthFixture(),
    },
  });
  const operations: AgentOperationsContextValue = {
    readGeneratedImage: async () => {
      throw new Error("Unexpected generated image read");
    },
    readSessionTodos: async () => [],
    readSessionHistory: async () => [],
    loadAgentSessionHistory: async () => null,
    loadAgentSessionContext: async () => undefined,
    startAgentSession: async () => {
      throw new Error("Not configured");
    },
    sendAgentMessage: async () => undefined,
    stopAgentSession: async () => undefined,
    updateAgentSessionModel: () => undefined,
    replyAgentApproval: async () => undefined,
    answerAgentQuestion: async () => undefined,
  };
  function Providers({ children, repoPath }: PropsWithChildren<{ repoPath: string | null }>) {
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ActiveWorkspaceContext
            value={{
              activeWorkspace: repoPath
                ? { workspaceId: "workspace", workspaceName: "Workspace", repoPath }
                : null,
              setActiveWorkspace: () => undefined,
            }}
          >
            <RuntimeDefinitionsContext value={definitions}>
              <RepoRuntimeHealthContext value={health}>
                <AgentSessionsContext value={sessions}>
                  <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
                </AgentSessionsContext>
              </RepoRuntimeHealthContext>
            </RuntimeDefinitionsContext>
          </ActiveWorkspaceContext>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
  const content = (repoPath: string | null) => (
    <Providers repoPath={repoPath}>
      <AgentSessionTranscriptDialogHost>
        <CaptureActions />
        {children}
      </AgentSessionTranscriptDialogHost>
    </Providers>
  );
  const view = render(content("/repo"));
  return {
    client,
    read,
    write,
    canonicalize,
    frames,
    async open(target: AgentSessionTranscriptTarget = dialogTargets.main) {
      act(() =>
        actions.openSessionTranscript({
          target,
          title: `Conversation ${target.externalSessionId}`,
        }),
      );
      await frames.flushFrames();
    },
    close() {
      act(() => actions.closeSessionTranscript());
    },
    changeRepo(repoPath: string | null) {
      view.rerender(content(repoPath));
    },
    async selectFile() {
      const link = await screen.findByRole("link", { name: "Open file" });
      link.focus();
      fireEvent.click(link);
      await screen.findByLabelText("Code editor");
      return link;
    },
    async edit(contents = "Local draft") {
      fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: contents } });
      await screen.findByRole("status", { name: "Unsaved changes" });
    },
    dispose() {
      view.unmount();
      for (const spy of spies) spy.mockRestore();
      configureShellBridge(previousBridge);
      client.clear();
      frames.restore();
    },
  };
}

export const dialogTargets = {
  main: {
    externalSessionId: "main",
    runtimeKind: "opencode",
    workingDirectory: "/repo/main",
    sessionScope: { kind: "workflow", taskId: "a", role: "build" },
  },
  child: {
    externalSessionId: "child",
    runtimeKind: "codex",
    workingDirectory: "/repo/child",
    sessionScope: { kind: "workflow", taskId: "a", role: "build" },
  },
  other: {
    externalSessionId: "other",
    runtimeKind: "opencode",
    workingDirectory: "/repo/other",
    sessionScope: { kind: "workflow", taskId: "b", role: "build" },
  },
} satisfies Record<string, AgentSessionTranscriptTarget>;

export const dialogTextFile = (rootPath: string, contents = `Contents of ${rootPath}`) => ({
  kind: "text" as const,
  rootPath,
  relativePath: "src/file.ts",
  contents,
  size: contents.length,
  mtimeMs: 1,
  revision: `revision:${contents}`,
});
