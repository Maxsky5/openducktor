import { expect, mock, test } from "bun:test";
import { createHostClient } from "@openducktor/host-client";
import type {
  WorkflowLaunchSnapshot,
  WorkflowLaunchRead,
  WorkflowLaunchRef,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import type { RunEventListener } from "@/lib/shell-bridge";
import { observeWorkflowLaunches } from "./workflow-launch-observation";
import { workflowLaunchResult } from "./session-start-workflow";

const failed: WorkflowLaunchSnapshot = {
  workspaceId: "workspace",
  repoPath: "/repo",
  taskId: "task",
  launchAttemptId: "attempt",
  role: "build",
  phase: "failed",
  acceptance: "rejected",
  ownershipSaved: true,
  recoveryAllowed: true,
  failure: { message: "Exact send failure", stage: "send", cleanupErrors: [] },
  completedPreStartActions: [],
  session: {
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/worktree",
    startedAt: "2026-10-04T00:00:00Z",
    status: "idle",
  },
};
const completed: WorkflowLaunchSnapshot = {
  ...failed,
  phase: "completed",
  acceptance: "accepted",
  recoveryAllowed: false,
};
delete completed.failure;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = async (read: (ref: WorkflowLaunchRead) => Promise<WorkflowLaunchSnapshot[]>) => {
  let listener: RunEventListener = () => {};
  const errors: unknown[] = [];
  const seen: WorkflowLaunchSnapshot[] = [];
  const first = deferred<void>();
  const client = createHostClient(async () => {
    throw new Error("Unexpected launch or history read");
  });
  client.agentSessionWorkflowLaunchRead = mock(read);
  client.agentSessionWorkflowLaunchRecover = mock(async (_ref: WorkflowLaunchRef) => completed);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stop = await observeWorkflowLaunches({
    workspaceId: "workspace",
    repoPath: "/repo",
    taskIds: ["task"],
    queryClient,
    bridge: {
      client,
      subscribeRunEvents: async (next) => {
        listener = next;
        return () => {};
      },
    },
    onSnapshot: (snapshot) => {
      seen.push(snapshot);
      first.resolve();
    },
    onError: (cause) => errors.push(cause),
  });
  return {
    seen,
    errors,
    client,
    first,
    stop: () => {
      stop();
      queryClient.clear();
    },
    emit: (snapshot: WorkflowLaunchSnapshot) =>
      listener({ type: "workflow_launch_updated", snapshot: JSON.stringify(snapshot) }),
    reconnect: () =>
      listener({ __openducktorBrowserLive: true, kind: "reconnected", transportEpoch: "new" }),
  };
};

test("attachment restores exact failure and same-attempt recovery without a launch or history read", async () => {
  const h = await fixture(async () => [failed]);
  try {
    await h.first.promise;
    const result = workflowLaunchResult(h.seen[0]!, h.seen[0]!, h.client);
    expect(result.postStartActionError?.message).toBe("Exact send failure");
    await result.retryPostStartMessage!();
    expect(h.client.agentSessionWorkflowLaunchRead).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repoPath: "/repo",
      taskId: "task",
    });
    expect(h.client.agentSessionWorkflowLaunchRecover).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repoPath: "/repo",
      taskId: "task",
      launchAttemptId: "attempt",
    });
    expect(h.errors).toEqual([]);
  } finally {
    h.stop();
  }
});

test("live failure received during attachment wins over its older active read", async () => {
  const read = deferred<WorkflowLaunchSnapshot[]>();
  const h = await fixture(() => read.promise);
  try {
    h.emit({ ...failed, workspaceId: "another" });
    h.emit(failed);
    read.resolve([{ ...failed, phase: "sending", failure: undefined, recoveryAllowed: false }]);
    await h.first.promise;
    expect(h.seen).toEqual([failed]);
    h.emit(completed);
    expect(h.seen.at(-1)?.phase).toBe("completed");
    expect(
      workflowLaunchResult(completed, completed, h.client).retryPostStartMessage,
    ).toBeUndefined();
  } finally {
    h.stop();
  }
});

test("reconnect reads fresh attempts while an old read is pending and detachment suppresses late events", async () => {
  const oldRead = deferred<WorkflowLaunchSnapshot[]>();
  let reads = 0;
  const h = await fixture(async () => (++reads === 1 ? oldRead.promise : [failed]));
  try {
    h.reconnect();
    await h.first.promise;
    oldRead.resolve([completed]);
    await Promise.resolve();
    expect(reads).toBe(2);
    expect(h.seen).toEqual([failed]);
    h.stop();
    h.emit(completed);
    expect(h.seen).toEqual([failed]);
    expect(h.errors).toEqual([]);
  } finally {
    h.stop();
  }
});

test.each(["unknown", "accepted"] as const)(
  "restored %s acceptance offers no resend",
  async (acceptance) => {
    const outcome = { ...failed, acceptance, recoveryAllowed: false };
    const h = await fixture(async () => [outcome]);
    try {
      await h.first.promise;
      const result = workflowLaunchResult(h.seen[0]!, h.seen[0]!, h.client);
      expect(result.postStartActionError?.message).toBe(
        "Exact send failure" +
          (acceptance === "unknown"
            ? " Runtime acceptance is unknown. Inspect the saved session before sending another instruction."
            : ""),
      );
      expect(result.retryPostStartMessage).toBeUndefined();
      expect(h.client.agentSessionWorkflowLaunchRecover).not.toHaveBeenCalled();
    } finally {
      h.stop();
    }
  },
);
