import { expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { synchronizeConnectionState } from "@openducktor/frontend-core/recovery/state-recovery";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import type { ResourceData, ResourceRead } from "../types/resource-source";
import { createUnavailableShellBridge, type ShellBridge } from "./shell-bridge";
import { ShellPlatformContext } from "./shell-platform";
import { useResourceSource } from "./use-resource-source";

function Source({ id, read }: { id: string; read: ResourceRead }) {
  const source = useResourceSource(["image"], read);
  return (
    <output data-testid={id} data-error={source.error?.message ?? ""}>
      {source.src ?? ""}
    </output>
  );
}

const image = (): ResourceData => ({
  kind: "blob",
  blob: new Blob(["image"], { type: "image/png" }),
});

function openTwoViews() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gate = Promise.withResolvers<ResourceData>();
  const cacheRemoved = Promise.withResolvers<void>();
  const unsubscribe = client.getQueryCache().subscribe(({ type }) => {
    if (type === "removed") cacheRemoved.resolve();
  });
  const read = mock<ResourceRead>(
    (signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        gate.promise.then(resolve, reject);
      }),
  );
  const tree = (showFirst: boolean) => (
    <QueryClientProvider client={client}>
      {showFirst ? <Source key="a" id="a" read={read} /> : null}
      <Source key="b" id="b" read={read} />
    </QueryClientProvider>
  );
  const view = render(tree(true));
  return {
    view,
    read,
    cacheRemoved: cacheRemoved.promise,
    closeFirst: () => view.rerender(tree(false)),
    finishRead: () => gate.resolve(image()),
    dispose: () => {
      view.unmount();
      gate.resolve(image());
      unsubscribe();
      client.clear();
    },
  };
}

test("two views read one resource and release their own URLs when they close", async () => {
  const release = spyOn(URL, "revokeObjectURL");
  const views = openTwoViews();
  try {
    await act(async () => views.finishRead());
    await waitFor(() => {
      expect(views.view.getByTestId("a").textContent).toStartWith("blob:");
      expect(views.view.getByTestId("b").textContent).toStartWith("blob:");
    });
    expect(views.read).toHaveBeenCalledTimes(1);
    const a = views.view.getByTestId("a").textContent;
    const b = views.view.getByTestId("b").textContent;
    expect(a).not.toBe(b);

    views.closeFirst();
    expect(release.mock.calls).toEqual([[a]]);
    expect(views.view.getByTestId("b").textContent).toBe(b);
    views.view.unmount();
    expect(release.mock.calls).toEqual([[a], [b]]);
    await views.cacheRemoved;
  } finally {
    views.dispose();
    release.mockRestore();
  }
});

test("closing the last view aborts a pending resource read without allocating a URL", async () => {
  const allocate = spyOn(URL, "createObjectURL");
  const views = openTwoViews();
  try {
    expect(views.read).toHaveBeenCalledTimes(1);
    const signal = views.read.mock.calls[0]![0];
    views.closeFirst();
    expect(signal.aborted).toBe(false);
    views.view.unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => views.finishRead());
    expect(allocate).not.toHaveBeenCalled();
    await views.cacheRemoved;
  } finally {
    views.dispose();
    allocate.mockRestore();
  }
});

test("a new connection generation retries a failed read that synchronization leaves alone", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let state: RemoteConnectionState = { status: "connected", generation: 1 };
  const listeners = new Set<(state: RemoteConnectionState) => void>();
  const shellPlatform: ShellBridge = {
    ...createUnavailableShellBridge(),
    remoteConnection: {
      readState: () => state,
      subscribeState: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      connect: async () => {},
      disconnect: async () => {},
      retry: async () => {},
    },
  };
  const read = mock<ResourceRead>(async () => image()).mockRejectedValueOnce(
    new Error("Resource unavailable."),
  );
  const view = render(
    <ShellPlatformContext value={shellPlatform}>
      <QueryClientProvider client={client}>
        <Source id="retry" read={read} />
      </QueryClientProvider>
    </ShellPlatformContext>,
  );
  try {
    const output = view.getByTestId("retry");
    await waitFor(() => expect(output.getAttribute("data-error")).toBe("Resource unavailable."));
    await act(async () => {
      await synchronizeConnectionState(client, [], false, {
        hostChanged: false,
        missedEventNames: [],
      });
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(output.getAttribute("data-error")).toBe("Resource unavailable.");

    await act(async () => {
      state = { status: "connected", generation: 2 };
      for (const listener of listeners) listener(state);
    });
    await waitFor(() => expect(output.textContent).toStartWith("blob:"));
    expect(output.getAttribute("data-error")).toBe("");
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    client.clear();
  }
});
