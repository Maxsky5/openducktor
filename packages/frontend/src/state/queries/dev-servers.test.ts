import { describe, expect, test } from "bun:test";
import type { DevServerGroupState } from "@openducktor/contracts";
import { QueryClient, type QueryFunction } from "@tanstack/react-query";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  buildScript,
  buildState,
} from "@/features/dev-servers/use-agent-studio-dev-server-panel-test-fixtures";
import { devServerGroupStateQueryOptions, devServerQueryKeys } from "./dev-servers";

describe("dev server metadata queries", () => {
  test("keeps a live terminal ID when an event arrives after the query returns", async () => {
    const client = new QueryClient();
    const older = buildState({ revision: 1 });
    const newer = buildState({
      revision: 2,
      scripts: [buildScript({ status: "running", pid: 123, terminalId: "live-output" })],
    });
    const previousBridge = getShellBridge();
    configureShellBridge(
      createShellBridgeFixture({ client: { devServerGetState: async () => older } }),
    );
    const options = devServerGroupStateQueryOptions(older.repoPath, older.owner, "epoch");
    // SAFETY: devServerGroupStateQueryOptions always supplies this callable query function.
    const queryFn = options.queryFn as QueryFunction<
      DevServerGroupState,
      ReturnType<typeof devServerQueryKeys.state>
    >;
    try {
      await client.fetchQuery({
        ...options,
        queryFn: async (context) => {
          const result = await queryFn(context);
          queueMicrotask(() => client.setQueryData(options.queryKey, newer));
          return result;
        },
      });
      expect(client.getQueryData<DevServerGroupState>(options.queryKey)).toEqual(newer);
      expect(
        client.getQueryData<DevServerGroupState>(options.queryKey)?.scripts[0]?.terminalId,
      ).toBe("live-output");
      client.setQueryData(options.queryKey, older);
      expect(client.getQueryData<DevServerGroupState>(options.queryKey)).toEqual(newer);
    } finally {
      configureShellBridge(previousBridge);
      client.clear();
    }
  });
});
