import { expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Activity, useRef, useState } from "react";
import { createMemoryRouter, NavigationType, RouterProvider } from "react-router";
import { createSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import {
  SessionViewContext,
  SessionViewShownContext,
} from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import {
  usePublishVisibleSessionTarget,
  VisibleSessionTargetProvider,
} from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { NotificationAttentionProvider } from "./notification-attention";
import { useRegisterNotificationTranscript } from "./notification-attention-context";

const identity: AgentSessionIdentity = {
  externalSessionId: "current",
  runtimeKind: "codex",
  workingDirectory: "/repo",
};
const target = {
  kind: "task_session",
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "build",
  identity,
} as const;
const previous = { ...target, identity: { ...identity, workingDirectory: "/repo/old-worktree" } };

function Transcript({
  name,
  hasTarget = true,
  session = identity,
}: {
  name: string;
  hasTarget?: boolean;
  session?: AgentSessionIdentity;
}) {
  const root = useRef<HTMLDivElement>(null);
  useRegisterNotificationTranscript(root, {
    kind: "session",
    repoPath: "/repo",
    target: {
      ...session,
      sessionScope: {
        kind: "workflow",
        workspaceId: "workspace-1",
        taskId: "task-1",
        role: "build",
      },
    },
    displayedSessionKey: session.externalSessionId,
    notice: null,
    shouldResetWindow: false,
    session: {
      ...session,
      activityState: "waiting_input",
      runtimeStatusMessage: null,
      messages: createSessionMessagesState(session.externalSessionId),
      pendingQuestions: [],
    },
  });
  return (
    <div ref={root}>
      {hasTarget ? (
        <div
          data-testid={name}
          data-notification-attention-kind="question"
          data-notification-attention-id="request-1"
          tabIndex={-1}
        >
          {name}
        </div>
      ) : null}
    </div>
  );
}

function VisibleConversation({ retainedSelection }: { retainedSelection: boolean }) {
  const [showTarget, setShowTarget] = useState(false);
  usePublishVisibleSessionTarget(retainedSelection && !showTarget ? previous : target);
  return (
    <>
      <Activity mode="hidden">
        <Transcript name="hidden transcript" session={{ ...identity, externalSessionId: "old" }} />
      </Activity>
      {retainedSelection && !showTarget ? (
        <Transcript name="previous selection" session={previous.identity} />
      ) : (
        <Transcript name="request in active transcript" hasTarget={showTarget} />
      )}
      <button type="button" onClick={() => setShowTarget(true)}>
        Show request
      </button>
    </>
  );
}

test.each([
  ["target arrives later", false, "request-1"],
  ["previous selection shares the native ID", true, "request-1"],
  ["route state names another request", false, "unrelated"],
] as const)(
  "waits for the requested transcript when %s",
  async (_case, retainedSelection, requestId) => {
    const search = "?workspace=workspace-1&kind=task&task=task-1&session=current&agent=build";
    const state = {
      notificationTarget: {
        type: "pending_input",
        workspaceId: target.workspaceId,
        repoPath: "/repo",
        taskId: target.taskId,
        session: requestId === "request-1" ? identity : previous.identity,
        inputKind: "question",
        requestId,
      },
      context: "keep",
    };
    const router = createMemoryRouter(
      [
        {
          path: "/sessions",
          element: (
            <VisibleSessionTargetProvider>
              <NotificationAttentionProvider>
                <SessionViewContext value={{ id: "kept-view", isActive: false }}>
                  <SessionViewShownContext value={false}>
                    <div hidden inert>
                      <Transcript name="retained view" />
                    </div>
                  </SessionViewShownContext>
                </SessionViewContext>
                <SessionViewContext value={{ id: "current-view", isActive: true }}>
                  <VisibleConversation retainedSelection={retainedSelection} />
                </SessionViewContext>
              </NotificationAttentionProvider>
            </VisibleSessionTargetProvider>
          ),
        },
      ],
      {
        initialEntries: [
          {
            pathname: "/sessions",
            search: search + "&attention=question&attentionId=request-1",
            state,
          },
        ],
      },
    );
    const view = render(<RouterProvider router={router} />);
    expect(router.state.location.search).toContain("attentionId=request-1");
    expect(document.activeElement).not.toBe(view.getByTestId("retained view"));
    expect(document.activeElement).not.toBe(view.getByTestId("hidden transcript"));
    if (retainedSelection)
      expect(document.activeElement).not.toBe(view.getByTestId("previous selection"));

    fireEvent.click(view.getByRole("button", { name: "Show request" }));

    await waitFor(() => expect(router.state.location.search).not.toContain("attention"));
    expect(document.activeElement).toBe(view.getByTestId("request in active transcript"));
    expect(router.state.location.pathname).toBe("/sessions");
    expect(router.state.location.search).toBe(search);
    expect(router.state.location.state).toEqual(state);
    expect(router.state.historyAction).toBe(NavigationType.Replace);
    view.unmount();
    router.dispose();
  },
);
