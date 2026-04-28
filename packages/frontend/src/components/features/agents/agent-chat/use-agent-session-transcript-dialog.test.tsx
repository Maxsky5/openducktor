import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";

let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualTranscriptDialog: Awaited<typeof import("./agent-session-transcript-dialog")>;

const removeAgentSession = mock(async () => {});
let agentSessionState: { purpose?: "primary" | "transcript" } | null = null;
let latestDialogProps: {
  sessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
  title: string;
  description: string;
} | null = null;

const transcriptSource: RuntimeSessionTranscriptSource = {
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/repo-a",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
};

describe("AgentSessionTranscriptDialogHost", () => {
  beforeAll(async () => {
    [actualAppStateProvider, actualTranscriptDialog] = await Promise.all([
      import("@/state/app-state-provider"),
      import("./agent-session-transcript-dialog"),
    ]);
  });

  beforeEach(() => {
    latestDialogProps = null;
    removeAgentSession.mockClear();
    agentSessionState = null;

    mock.module("@/state/app-state-provider", () => ({
      useActiveWorkspace: () => ({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      }),
      useAgentOperations: () => ({
        removeAgentSession,
      }),
      useAgentSession: () => agentSessionState,
    }));

    mock.module("./agent-session-transcript-dialog", () => ({
      AgentSessionTranscriptDialog: (props: {
        sessionId: string | null;
        source: RuntimeSessionTranscriptSource | null;
        title: string;
        description: string;
      }): ReactElement => {
        latestDialogProps = props;
        return <div data-testid="session-dialog-props">{props.sessionId}</div>;
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => Promise.resolve(actualAppStateProvider)],
      ["./agent-session-transcript-dialog", () => Promise.resolve(actualTranscriptDialog)],
    ]);
  });

  test("passes runtime transcript requests through without task context", async () => {
    const { AgentSessionTranscriptDialogHost, useAgentSessionTranscriptDialog } = await import(
      "./use-agent-session-transcript-dialog"
    );

    function OpenDialogButton(): ReactElement {
      const { openSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <button
          type="button"
          onClick={() => {
            openSessionTranscript({
              sessionId: "session-child-1",
              source: transcriptSource,
              title: "Subagent activity",
              description: "View what this subagent did.",
            });
          }}
        >
          Open
        </button>
      );
    }

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<OpenDialogButton />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        sessionId: "session-child-1",
        source: transcriptSource,
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });

  test("removes transcript-only sessions when the dialog closes", async () => {
    agentSessionState = { purpose: "transcript" };

    const { AgentSessionTranscriptDialogHost, useAgentSessionTranscriptDialog } = await import(
      "./use-agent-session-transcript-dialog"
    );

    function DialogControls(): ReactElement {
      const { openSessionTranscript, closeSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              openSessionTranscript({
                sessionId: "session-child-1",
                source: transcriptSource,
              });
            }}
          >
            Open
          </button>
          <button type="button" onClick={() => closeSessionTranscript()}>
            Close
          </button>
        </>
      );
    }

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<DialogControls />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(latestDialogProps?.sessionId).toBe("session-child-1"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(removeAgentSession).toHaveBeenCalledWith("session-child-1"));
  });

  test("keeps regular sessions when the dialog closes", async () => {
    agentSessionState = { purpose: "primary" };

    const { AgentSessionTranscriptDialogHost, useAgentSessionTranscriptDialog } = await import(
      "./use-agent-session-transcript-dialog"
    );

    function DialogControls(): ReactElement {
      const { openSessionTranscript, closeSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              openSessionTranscript({
                sessionId: "session-build-1",
                source: transcriptSource,
              });
            }}
          >
            Open
          </button>
          <button type="button" onClick={() => closeSessionTranscript()}>
            Close
          </button>
        </>
      );
    }

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<DialogControls />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(latestDialogProps?.sessionId).toBe("session-build-1"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(removeAgentSession).not.toHaveBeenCalled());
  });
});
