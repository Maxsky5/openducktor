import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type {
  AgentSessionBackgroundTask,
  AgentSessionBackgroundTaskStopInput,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import type { AgentSessionReadModelLoadState } from "../../types/agent-session-read-model";
import { createActiveWorkspaceWrapper } from "../../test-support/active-workspace-wrapper";
import { enableReactActEnvironment } from "../../test-support/react-act-environment";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createAgentSessionFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { AgentSessionReadModelStateContext, AgentSessionsContext } from "../session-contexts";
import { useBackgroundTaskStops, useSessionBackgroundTasks } from "./use-session-background-tasks";

enableReactActEnvironment();

const identity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
};
const server: AgentSessionBackgroundTask = {
  taskId: "shell-1",
  kind: "command",
  title: "bun run dev",
  stop: { allowed: true },
};

const mountStops = (stop: (input: AgentSessionBackgroundTaskStopInput) => Promise<void>) =>
  createHookHarness<
    Parameters<typeof useBackgroundTaskStops>[0],
    ReturnType<typeof useBackgroundTaskStops>
  >(
    useBackgroundTaskStops,
    { repoPath: "/repo", identity, tasks: [server] },
    {
      wrapper: createActiveWorkspaceWrapper(
        createTestClientConnection({ client: { agentSessionBackgroundTaskStop: stop } }),
      ),
    },
  );

describe("useBackgroundTaskStops", () => {
  test("stays Stopping after the host accepts, and drops the row when the task ends", async () => {
    const calls: AgentSessionBackgroundTaskStopInput[] = [];
    const harness = mountStops(async (input) => {
      calls.push(input);
    });
    try {
      await harness.mount();
      await harness.run((model) => model?.onStop("shell-1"));

      expect(calls).toEqual([{ ...identity, repoPath: "/repo", taskId: "shell-1" }]);
      expect(harness.getLatest()?.rows[0]?.stop).toEqual({
        control: { label: "Stopping", busy: true },
        note: null,
      });

      await harness.update({ repoPath: "/repo", identity, tasks: undefined });
      expect(harness.getLatest()).toBeNull();

      // A task that runs again under the same ID can stop again.
      await harness.update({ repoPath: "/repo", identity, tasks: [server] });
      expect(harness.getLatest()?.rows[0]?.stop).toEqual({
        control: { label: "Stop", busy: false },
        note: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("sends nothing for a confirmed task that ended, and stops only the confirmed task", async () => {
    const calls: AgentSessionBackgroundTaskStopInput[] = [];
    const harness = mountStops(async (input) => {
      calls.push(input);
    });
    const replacement: AgentSessionBackgroundTask = { ...server, taskId: "shell-2" };
    try {
      await harness.mount();
      // The confirmation keeps the Stop of the model that showed the row.
      const confirmedStop = harness.getLatest()?.onStop;
      if (!confirmedStop) throw new Error("The model has a running task.");

      // The confirmed run ends and a replacement run starts before the user confirms.
      await harness.update({ repoPath: "/repo", identity, tasks: [replacement] });
      await harness.run(() => confirmedStop("shell-1"));

      expect(calls).toEqual([]);
      expect(harness.getLatest()?.rows[0]?.stop).toEqual({
        control: { label: "Stop", busy: false },
        note: null,
      });

      await harness.run(() => confirmedStop("shell-2"));
      expect(calls).toEqual([{ ...identity, repoPath: "/repo", taskId: "shell-2" }]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the row and shows the reason when the stop fails", async () => {
    const harness = mountStops(async () => {
      throw new Error("Shell is not running");
    });
    try {
      await harness.mount();
      await harness.run((model) => model?.onStop("shell-1"));
      await harness.waitFor((model) => model?.rows[0]?.stop.note?.tone === "error");

      expect(harness.getLatest()?.rows[0]?.stop).toEqual({
        control: { label: "Stop", busy: false },
        note: { text: "Shell is not running", tone: "error" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("applies a late failure only to its own session and request", async () => {
    let rejectFirst: (cause: Error) => void = () => undefined;
    let calls = 0;
    const harness = mountStops(
      () =>
        new Promise<void>((_resolve, reject) => {
          calls += 1;
          if (calls === 1) rejectFirst = reject;
        }),
    );
    const other = { ...identity, externalSessionId: "session-2" };
    try {
      await harness.mount();
      await harness.run((model) => model?.onStop("shell-1"));
      await harness.update({ repoPath: "/repo", identity: other, tasks: [server] });
      await harness.run((model) => model?.onStop("shell-1"));

      await harness.run(() => rejectFirst(new Error("Session A failed")));

      expect(harness.getLatest()?.rows[0]?.stop).toEqual({
        control: { label: "Stopping", busy: true },
        note: null,
      });
    } finally {
      await harness.unmount();
    }
  });
});

const backgroundSession = createAgentSessionFixture({
  ...identity,
  status: "running",
  foregroundTurnActive: false,
  livePresence: "present",
  backgroundTasks: [server],
});

const mountSessionTasks = () => {
  const calls: AgentSessionBackgroundTaskStopInput[] = [];
  const sessionStore = createAgentSessionsStore("/repo");
  sessionStore.replaceSession(backgroundSession);
  let loadState: AgentSessionReadModelLoadState = { kind: "ready", workspaceRepoPath: "/repo" };
  const setLoadState = (next: AgentSessionReadModelLoadState) => {
    loadState = next;
  };
  const ActiveWorkspace = createActiveWorkspaceWrapper(
    createTestClientConnection({
      client: {
        agentSessionBackgroundTaskStop: async (input) => {
          calls.push(input);
        },
      },
    }),
  );
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(
      ActiveWorkspace,
      null,
      createElement(
        AgentSessionReadModelStateContext,
        {
          value: {
            sessionReadModelLoadState: loadState,
            workspaceSessionRecordsError: null,
            reloadSessionReadModel: () => {},
            getSessionFault: () => null,
          },
        },
        createElement(AgentSessionsContext, { value: sessionStore }, children),
      ),
    );
  const props = { repoPath: "/repo", identity };
  const harness = createHookHarness(useSessionBackgroundTasks, props, { wrapper });
  return { calls, sessionStore, setLoadState, props, harness };
};

describe("useSessionBackgroundTasks", () => {
  test("hides the rows and sends no Stop while the status of the session is unavailable", async () => {
    const { calls, sessionStore, harness } = mountSessionTasks();
    try {
      await harness.mount();
      // The user opens the confirmation while the status is known.
      const confirmedStop = harness.getLatest()?.onStop;
      if (!confirmedStop) throw new Error("The model has a running task.");

      // The runtime loses the tracking of this session. The workspace observation stays ready.
      await harness.run(() =>
        sessionStore.replaceSession({
          ...backgroundSession,
          statusUnavailableReason: "Cannot read the shell end notice.",
        }),
      );
      expect(harness.getLatest()).toBeNull();

      await harness.run(() => confirmedStop("shell-1"));
      expect(calls).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("hides the rows and sends no Stop until a new snapshot confirms the live state", async () => {
    const { calls, setLoadState, props, harness } = mountSessionTasks();
    try {
      await harness.mount();
      // The user opens the confirmation while the live state is known.
      const confirmedStop = harness.getLatest()?.onStop;
      if (!confirmedStop) throw new Error("The model has a running task.");

      setLoadState({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message: "Live stream ended",
        source: "live-stream",
      });
      await harness.update(props);
      expect(harness.getLatest()).toBeNull();

      await harness.run(() => confirmedStop("shell-1"));
      expect(calls).toEqual([]);

      // A retry loads again. The rows stay hidden until a new snapshot confirms the session.
      setLoadState({
        kind: "loading",
        workspaceRepoPath: "/repo",
        liveStreamFailure: "Live stream ended",
      });
      await harness.update(props);
      expect(harness.getLatest()).toBeNull();
      await harness.run(() => confirmedStop("shell-1"));
      expect(calls).toEqual([]);

      setLoadState({ kind: "loading", workspaceRepoPath: "/repo" });
      await harness.update(props);
      expect(harness.getLatest()?.rows.map((row) => row.title)).toEqual(["bun run dev"]);

      setLoadState({ kind: "ready", workspaceRepoPath: "/repo" });
      await harness.update(props);
      expect(harness.getLatest()?.rows.map((row) => row.title)).toEqual(["bun run dev"]);
    } finally {
      await harness.unmount();
    }
  });
});
