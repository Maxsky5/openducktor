import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SystemOpenInToolInfo } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { host } from "../operations/host";
import {
  ensureOpenInToolsFromQuery,
  loadOpenInToolsFromQuery,
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
  });

  test("ensureOpenInToolsFromQuery reuses cached discovery data without refetching", async () => {
    const systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: null },
          { toolId: "ghostty", iconDataUrl: "data:image/png;base64,ghostty" },
        ] satisfies SystemOpenInToolInfo[],
    );
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = systemListOpenInTools;

    try {
      await loadOpenInToolsFromQuery(queryClient);
      expect(systemListOpenInTools).toHaveBeenCalledTimes(1);

      await ensureOpenInToolsFromQuery(queryClient);
      expect(systemListOpenInTools).toHaveBeenCalledTimes(1);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
      queryClient.clear();
    }
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
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = systemListOpenInTools;

    try {
      const first = await loadOpenInToolsFromQuery(queryClient);
      const refreshed = await refreshOpenInToolsFromQuery(queryClient);

      expect(first[0]?.toolId).toBe("finder");
      expect(refreshed[0]?.toolId).toBe("zed");
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(1, false);
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(2, true);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
      queryClient.clear();
    }
  });
});
