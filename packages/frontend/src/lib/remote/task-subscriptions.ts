import type { TaskEventCursor, TaskEventStreamFrame } from "@openducktor/contracts";
import type { RemoteHostClient, RemoteTaskSubscription } from "@openducktor/host-client/remote";
import type { ShellBridge, TaskStreamSubscription } from "../shell-bridge";
type TaskOwner = {
  abort: AbortController;
  cursor: TaskEventCursor | null;
  handle: RemoteTaskSubscription | null;
  active: boolean;
  opening: Promise<RemoteTaskSubscription> | null;
  onFrame(frame: TaskEventStreamFrame): void;
};
export type BrowserRemoteTaskSubscriptions = {
  subscribeTaskStream: ShellBridge["subscribeTaskStream"];
  synchronize(): Promise<void>;
  invalidate(): void;
};
export const createBrowserRemoteTaskSubscriptions = (
  remote: RemoteHostClient,
): BrowserRemoteTaskSubscriptions => {
  const tasks = new Set<TaskOwner>();
  const open = (owner: TaskOwner): Promise<RemoteTaskSubscription> => {
    if (owner.handle) return Promise.resolve(owner.handle);
    if (owner.opening) return owner.opening;
    const opening = remote
      .subscribeTaskStream({ cursor: owner.cursor }, owner.onFrame, owner.abort.signal)
      .then(async (handle) => {
        if (!owner.active) {
          await handle.unsubscribe();
          throw new Error("Task subscription was closed.");
        }
        owner.handle = handle;
        return handle;
      });
    owner.opening = opening;
    void opening
      .finally(() => {
        if (owner.opening === opening) owner.opening = null;
      })
      .catch(() => {});
    return opening;
  };
  const restore = async (owner: TaskOwner) => {
    try {
      const handle = await open(owner);
      if (owner.active) await handle.ready;
    } catch (cause) {
      // Canceled views no longer hold the connection barrier.
      if (owner.active) throw cause;
    }
  };
  return {
    synchronize: async () => {
      await Promise.all([...tasks].filter((owner) => owner.active).map(restore));
    },
    invalidate: () => {
      for (const owner of tasks) owner.handle = null;
    },
    subscribeTaskStream: async (
      input,
      onFrame,
      onFailure,
      signal,
    ): Promise<TaskStreamSubscription> => {
      signal?.throwIfAborted();
      const owner: TaskOwner = {
        abort: new AbortController(),
        cursor: input.cursor,
        active: true,
        opening: null,
        handle: null,
        onFrame,
      };
      const cancel = () => {
        owner.active = false;
        tasks.delete(owner);
        owner.abort.abort();
        signal?.removeEventListener("abort", cancel);
      };
      tasks.add(owner);
      signal?.addEventListener("abort", cancel, { once: true });
      const { status } = remote.readState();
      if (status === "synchronizing" || status === "connected") {
        void open(owner).catch((cause) => {
          if (owner.active) onFailure?.(cause);
        });
      }
      // The local handle survives failed admission so Retry can restore delivery.
      return {
        subscriptionId: crypto.randomUUID(),
        acknowledge: async (cursor) => {
          if (!owner.handle) throw new Error("Task stream is disconnected. Wait for reconnection.");
          const handle = owner.handle;
          await handle.acknowledge(cursor);
          if (owner.handle !== handle)
            throw new Error("The task acknowledgement belongs to an old connection.");
          owner.cursor = cursor;
        },
        unsubscribe: async () => {
          cancel();
          await owner.handle?.unsubscribe();
        },
      };
    },
  };
};

export const waitForRemoteAdmission = (
  remote: RemoteHostClient,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let stop = () => {};
    let settled = false;
    const finish = (cause?: Error) => {
      if (settled) return;
      settled = true;
      stop();
      signal?.removeEventListener("abort", canceled);
      if (cause) reject(cause);
      else resolve();
    };
    const canceled = () => finish(new Error("The remote attachment was canceled."));
    signal?.addEventListener("abort", canceled, { once: true });
    if (signal?.aborted) canceled();
    stop = remote.subscribeState((state) => {
      if (state.status === "synchronizing" || state.status === "connected") finish();
      else if (state.status === "failed")
        finish(new Error(state.failure?.message ?? "The remote connection is inactive."));
    });
    if (settled) stop();
  });
