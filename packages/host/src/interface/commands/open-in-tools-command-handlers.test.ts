import { Effect } from "effect";
import type { OpenInToolsService } from "../../application/system/open-in-tools-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createOpenInToolsCommandHandlers } from "./open-in-tools-command-handlers";

const createRecordingService = () => {
  const calls: Array<{
    method: keyof OpenInToolsService;
    input: unknown;
  }> = [];
  const promiseService: OpenInToolsService = {
    listOpenInTools(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "listOpenInTools", input });
          return [{ toolId: "finder", iconDataUrl: null }];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    openDirectoryInTool(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "openDirectoryInTool", input });
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    openExternalUrl(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "openExternalUrl", input });
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  };
  const service = promiseService as OpenInToolsService;
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
