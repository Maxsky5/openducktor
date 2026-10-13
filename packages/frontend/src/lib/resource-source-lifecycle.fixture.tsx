import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ResourceData, ResourceRead } from "../types/resource-source";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";

GlobalRegistrator.register({ url: "https://frontend.test" });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const { act, render, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useResourceSource } = await import("./use-resource-source");
const { synchronizeBrowserState } = await import("./remote/state-recovery");
const { configureShellBridge, createUnavailableShellBridge } = await import("./shell-bridge");
const allocations: string[] = [];
const releases: string[] = [];
URL.createObjectURL = () => {
  const src = `blob:resource-${allocations.length}`;
  allocations.push(src);
  return src;
};
URL.revokeObjectURL = (src) => {
  releases.push(src);
};

function Source({ id, read }: { id: string; read: ResourceRead }) {
  const source = useResourceSource(["image"], read);
  return (
    <output data-testid={id} data-error={source.error?.message ?? ""}>
      {source.src ?? ""}
    </output>
  );
}

for (const pending of [false, true]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gate = Promise.withResolvers<ResourceData>();
  let reads = 0;
  let signal!: AbortSignal;
  const read: ResourceRead = (next) => {
    reads += 1;
    signal = next;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      gate.promise.then(resolve, reject);
    });
  };
  const tree = (a: boolean, b: boolean) => (
    <QueryClientProvider client={client}>
      {a ? <Source key="a" id="a" read={read} /> : null}
      {b ? <Source key="b" id="b" read={read} /> : null}
    </QueryClientProvider>
  );
  const view = render(tree(true, true));
  const allocationCount = allocations.length;
  try {
    await waitFor(() => assert.equal(reads, 1));
    if (pending) {
      view.rerender(tree(false, true));
      assert.equal(signal.aborted, false);
      view.unmount();
      assert.equal(signal.aborted, true);
      await act(async () => {
        gate.resolve({ kind: "blob", blob: new Blob(["image"], { type: "image/png" }) });
      });
      assert.equal(allocations.length, allocationCount);
    } else {
      await act(async () => {
        gate.resolve({ kind: "blob", blob: new Blob(["image"], { type: "image/png" }) });
      });
      await waitFor(() => {
        assert.ok(view.getByTestId("a").textContent);
        assert.ok(view.getByTestId("b").textContent);
      });
      const a = view.getByTestId("a").textContent!;
      const b = view.getByTestId("b").textContent!;
      assert.notEqual(a, b);
      view.rerender(tree(false, true));
      assert.ok(releases.includes(a));
      assert.equal(releases.includes(b), false);
      assert.equal(view.getByTestId("b").textContent, b);
      view.unmount();
      assert.ok(releases.includes(b));
    }
    await waitFor(() => assert.equal(client.getQueryCache().getAll().length, 0));
  } finally {
    view.unmount();
    gate.resolve({ kind: "blob", blob: new Blob() });
    client.clear();
  }
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let state: RemoteConnectionState = { status: "connected", generation: 1 };
const listeners = new Set<(state: RemoteConnectionState) => void>();
configureShellBridge({
  ...createUnavailableShellBridge(),
  remoteConnection: {
    readState: () => state,
    subscribeState: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry: async () => {},
  },
});
let reads = 0;
const read: ResourceRead = async () => {
  reads += 1;
  if (reads === 1) throw new Error("Resource unavailable.");
  return { kind: "blob", blob: new Blob(["image"], { type: "image/png" }) };
};
const view = render(
  <QueryClientProvider client={client}>
    <Source id="retry" read={read} />
  </QueryClientProvider>,
);
try {
  await waitFor(() =>
    assert.equal(view.getByTestId("retry").getAttribute("data-error"), "Resource unavailable."),
  );
  await synchronizeBrowserState(client, [], false);
  assert.equal(reads, 1);
  assert.equal(view.getByTestId("retry").getAttribute("data-error"), "Resource unavailable.");
  await act(async () => {
    state = { status: "connected", generation: 2 };
    for (const listener of listeners) listener(state);
  });
  await waitFor(() => assert.ok(view.getByTestId("retry").textContent));
  assert.equal(view.getByTestId("retry").getAttribute("data-error"), "");
  assert.equal(reads, 2);
} finally {
  view.unmount();
  client.clear();
  configureShellBridge(createUnavailableShellBridge());
}
