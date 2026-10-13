import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createHostRuntimeStatusOwner } from "../../frontend/src/state/host-runtime/host-runtime-status-owner";
import {
  hostRuntimeStatusQueryOptions,
  hostRuntimeStatusQueryKeys,
} from "../../frontend/src/state/queries/host-runtime-status";
import { createHostMcpBridgeStatusFixture } from "../../frontend/src/test-utils/shared-test-fixtures";
import { browserLiveStreamWarningEvent } from "@openducktor/frontend/lib/browser-live-control-events";
import type { RuntimeChangeListener } from "@openducktor/frontend/lib/shell-bridge";
import type { HostRuntimeSnapshot } from "@openducktor/contracts";
import { synchronizeBrowserState } from "@openducktor/frontend/lib/remote/state-recovery";
import { resourceSourceQueryOptions } from "../../frontend/src/state/queries/resource-sources";

test.each(["resource", "shell"])(
  "a %s failure does not fail remote work recovery",
  async (kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let reads = 0;
    const failed = Promise.withResolvers<void>();
    const read = async () => {
      reads += 1;
      throw new Error("The independent read failed.");
    };
    const observer = new QueryObserver(
      client,
      kind === "resource"
        ? resourceSourceQueryOptions(["missing-image"], 1, read)
        : { queryKey: ["shell", "remote-access"], queryFn: read },
    );
    const stop = observer.subscribe((result) => {
      if (result.isError) failed.resolve();
    });
    try {
      await failed.promise;
      await synchronizeBrowserState(client, [], true);
      expect(observer.getCurrentResult().error?.message).toBe("The independent read failed.");
      expect(reads).toBe(1);
    } finally {
      stop();
      client.clear();
    }
  },
);

test.each(["success", "failure", "superseded"])(
  "runtime baseline recovery participates in the connection barrier (%s)",
  async (result) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let listener!: RuntimeChangeListener;
    let reads = 0;
    const started = Promise.withResolvers<void>();
    const replacement = Promise.withResolvers<HostRuntimeSnapshot>();
    const supersedingStarted = Promise.withResolvers<void>();
    const superseding = Promise.withResolvers<HostRuntimeSnapshot>();
    const snapshot = (hostInstanceId: string): HostRuntimeSnapshot => ({
      hostInstanceId,
      runtimes: [],
      mcpBridge: createHostMcpBridgeStatusFixture(),
    });
    const runtimeStatus = async () => {
      reads += 1;
      if (reads === 1) return snapshot("old");
      if (reads === 3) {
        supersedingStarted.resolve();
        return superseding.promise;
      }
      started.resolve();
      return replacement.promise;
    };
    const owner = createHostRuntimeStatusOwner({
      queryClient,
      ports: {
        runtimeStatus,
        subscribeRuntimeChanges: async (next) => {
          listener = next;
          return () => {};
        },
      },
    });
    const observer = new QueryObserver(queryClient, {
      ...hostRuntimeStatusQueryOptions(runtimeStatus),
      enabled: false,
    });
    const stopObserver = observer.subscribe(() => {});
    const baseline = Promise.withResolvers<void>();
    const stopConnection = owner.subscribeConnection(() => {
      if (owner.getConnection().hasBaseline) baseline.resolve();
    });
    try {
      owner.start();
      await baseline.promise;
      listener(browserLiveStreamWarningEvent("Disconnected"));
      let settled = false;
      const recovery = synchronizeBrowserState(queryClient, [listener], true);
      const outcome = recovery.then(
        () => {
          settled = true;
          return null;
        },
        (cause: unknown) => {
          settled = true;
          return cause;
        },
      );
      await started.promise;
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(owner.getConnection().hasBaseline).toBe(false);
      expect(
        queryClient.getQueryData<HostRuntimeSnapshot>(hostRuntimeStatusQueryKeys.snapshot)
          ?.hostInstanceId,
      ).toBe("old");
      if (result === "superseded") {
        listener({
          type: "mcp_bridge_changed",
          hostInstanceId: "new",
          status: createHostMcpBridgeStatusFixture(),
        });
        await supersedingStarted.promise;
        await Bun.sleep(0);
        expect(settled).toBe(false);
        expect(owner.getConnection().hasBaseline).toBe(false);
        superseding.resolve(snapshot("new"));
      } else if (result === "failure") {
        replacement.reject(new Error("New host runtime baseline failed."));
      } else replacement.resolve(snapshot("new"));
      const cause = await outcome;
      if (result === "failure") {
        expect(cause).toBeInstanceOf(Error);
        expect(cause instanceof Error && cause.message).toContain(
          "New host runtime baseline failed.",
        );
        expect(owner.getConnection().hasBaseline).toBe(false);
      } else {
        expect(cause).toBeNull();
        expect(owner.getConnection().hasBaseline).toBe(true);
        expect(
          queryClient.getQueryData<HostRuntimeSnapshot>(hostRuntimeStatusQueryKeys.snapshot)
            ?.hostInstanceId,
        ).toBe("new");
      }
    } finally {
      owner.stop();
      stopObserver();
      stopConnection();
      queryClient.clear();
    }
  },
);
