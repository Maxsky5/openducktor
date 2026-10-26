import "../../test-support/dom-environment";
import { afterEach, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { AppVisibility } from "../../platform/app-visibility";
import { createLiveSnapshotEnvelope } from "../../test-support/agent-session-live-fixture";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { WorkspaceActivityContext } from "../../workspace-activity/workspace-activity-context";
import { createWorkspaceActivityObserver } from "../../workspace-activity/workspace-activity-observer";
import type { SessionNavigationTarget } from "./session-navigation-target";
import { SessionReadStateProvider, useSessionUnreadKey } from "./session-read-state";
import { sessionReadStateKey } from "./session-read-state-store";
import {
  usePublishVisibleSessionTarget,
  VisibleSessionTargetProvider,
} from "./visible-session-target";

const identity: AgentSessionIdentity = {
  externalSessionId: "native-chat",
  runtimeKind: "opencode",
  workingDirectory: "/alpha",
};
const target: SessionNavigationTarget = {
  kind: "workspace_session",
  workspaceId: "alpha",
  sessionId: "chat",
};
const idleSession: AgentSessionLiveSnapshot = {
  ref: { repoPath: "/alpha", ...identity },
  activity: "idle",
  title: "Chat",
  startedAt: new Date(1000).toISOString(),
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
};

const observers: ReturnType<typeof createWorkspaceActivityObserver>[] = [];
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.dispose());
});

const createVisibility = () => {
  const listeners = new Set<() => void>();
  let hidden = false;
  const visibility: AppVisibility = {
    isHidden: () => hidden,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  const setHidden = (next: boolean) => {
    hidden = next;
    for (const listener of listeners) listener();
  };
  return { visibility, setHidden };
};

const createObserver = () => {
  let emit: ((envelope: AgentSessionLiveEnvelope) => void) | null = null;
  const observer = createWorkspaceActivityObserver({
    observe: (_input, listener) => {
      emit = listener;
      return () => {
        emit = null;
      };
    },
    archivedSessions: {
      load: async () => {},
      read: () => ({ status: "ready", keys: new Set() }),
      subscribe: () => () => {},
    },
  });
  observers.push(observer);
  observer.syncWorkspaces([{ workspaceId: "alpha", repoPath: "/alpha" }]);
  const send = (envelope: AgentSessionLiveEnvelope) => {
    if (!emit) throw new Error("The live observer is missing.");
    emit(envelope);
  };
  send(createLiveSnapshotEnvelope({ repoPath: "/alpha", sessions: [idleSession] }));
  return { observer, send };
};

function VisibleChat(): ReactElement {
  usePublishVisibleSessionTarget(target, identity);
  const unread = useSessionUnreadKey(sessionReadStateKey("alpha", identity));
  return <output aria-label="Unread">{String(unread)}</output>;
}

test("keeps a completion of the visible session unread while the app is hidden, then reads it when the app shows", () => {
  const { visibility, setHidden } = createVisibility();
  const { observer, send } = createObserver();
  const view = render(
    <WorkspaceActivityContext value={observer}>
      <VisibleSessionTargetProvider>
        <SessionReadStateProvider visibility={visibility}>
          <VisibleChat />
        </SessionReadStateProvider>
      </VisibleSessionTargetProvider>
    </WorkspaceActivityContext>,
  );
  const unread = () => view.getByLabelText("Unread").textContent;

  act(() => {
    send({ type: "session_upsert", session: { ...idleSession, activity: "running" } });
    send({ type: "session_upsert", session: idleSession });
  });
  expect(unread()).toBe("false");

  act(() => setHidden(true));
  act(() => {
    send({ type: "session_upsert", session: { ...idleSession, activity: "running" } });
    send({ type: "session_upsert", session: idleSession });
  });
  expect(unread()).toBe("true");

  act(() => setHidden(false));
  expect(unread()).toBe("false");
});
