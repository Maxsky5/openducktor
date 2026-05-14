import type { SystemOpenInToolInfo } from "@openducktor/contracts";
import { createHostCommandRouter } from "./host-command-router";
import { createOpenInToolsCommandHandlers } from "./open-in-tools-command-handlers";
import type { OpenInToolsService } from "./open-in-tools-service";

const createRecordingService = () => {
  const calls: Array<{ method: keyof OpenInToolsService; input: unknown }> = [];
  const service: OpenInToolsService = {
    async listOpenInTools(input): Promise<SystemOpenInToolInfo[]> {
      calls.push({ method: "listOpenInTools", input });
      return [{ toolId: "finder", iconDataUrl: null }];
    },
    async openDirectoryInTool(input) {
      calls.push({ method: "openDirectoryInTool", input });
    },
    async openExternalUrl(input) {
      calls.push({ method: "openExternalUrl", input });
    },
  };

  return { calls, service };
};

describe("createOpenInToolsCommandHandlers", () => {
  test("routes open-in system commands to the service", async () => {
    const { calls, service } = createRecordingService();
    const router = createHostCommandRouter({
      handlers: createOpenInToolsCommandHandlers(service),
    });

    await expect(
      router.invoke("system_list_open_in_tools", { forceRefresh: true }),
    ).resolves.toEqual([{ toolId: "finder", iconDataUrl: null }]);
    await expect(
      router.invoke("system_open_directory_in_tool", {
        directoryPath: "/repo",
        toolId: "finder",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("open_external_url", {
        url: "https://example.com",
      }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      { method: "listOpenInTools", input: { forceRefresh: true } },
      {
        method: "openDirectoryInTool",
        input: { directoryPath: "/repo", toolId: "finder" },
      },
      { method: "openExternalUrl", input: { url: "https://example.com" } },
    ]);
  });
});
