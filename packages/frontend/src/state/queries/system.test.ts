import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SystemOpenInToolInfo } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  ensureOpenInToolsFromQuery,
  loadOpenInToolsFromQuery,
  platformQueryOptions,
  refreshOpenInToolsFromQuery,
  systemQueryKeys,
} from "./system";

describe("system queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  test("uses a global query key for Open In tool discovery", () => {
    expect(systemQueryKeys.openInTools()).toEqual(["system", "open-in-tools"]);
    expect(systemQueryKeys.platform()).toEqual(["system", "platform"]);
  });

  test("loads the process platform with a process-lifetime cache", async () => {
    const systemGetPlatform = mock(async () => "darwin" as const);
    const hostClient = { systemGetPlatform };
    const queryOptions = platformQueryOptions(hostClient);

    expect(queryOptions.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(queryOptions.staleTime).toBe(Number.POSITIVE_INFINITY);
    await expect(queryClient.fetchQuery(queryOptions)).resolves.toBe("darwin");
    await expect(queryClient.fetchQuery(queryOptions)).resolves.toBe("darwin");

    expect(systemGetPlatform).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  test("ensureOpenInToolsFromQuery reuses cached discovery data without refetching", async () => {
    const systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: null },
          { toolId: "ghostty", iconDataUrl: "data:image/png;base64,ghostty" },
        ] satisfies SystemOpenInToolInfo[],
    );
    const hostClient = { systemListOpenInTools };

    await loadOpenInToolsFromQuery(queryClient, hostClient);
    expect(systemListOpenInTools).toHaveBeenCalledTimes(1);

    await ensureOpenInToolsFromQuery(queryClient, hostClient);
    expect(systemListOpenInTools).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  test("refreshOpenInToolsFromQuery bypasses the cached discovery result", async () => {
    const systemListOpenInTools = mock(
      async (forceRefresh = false) =>
        [
          {
            toolId: forceRefresh ? "zed" : "finder",
            iconDataUrl: null,
          },
        ] satisfies SystemOpenInToolInfo[],
    );
    const hostClient = { systemListOpenInTools };

    const [first, refreshed] = await Promise.all([
      loadOpenInToolsFromQuery(queryClient, hostClient),
      refreshOpenInToolsFromQuery(queryClient, hostClient),
    ]);

    expect(first[0]?.toolId).toBe("finder");
    expect(refreshed[0]?.toolId).toBe("zed");
    expect(systemListOpenInTools).toHaveBeenNthCalledWith(1);
    expect(systemListOpenInTools).toHaveBeenNthCalledWith(2, true);
    queryClient.clear();
  });
});
