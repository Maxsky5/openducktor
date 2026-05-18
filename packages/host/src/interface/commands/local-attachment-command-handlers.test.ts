import { Effect } from "effect";
import type { LocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createLocalAttachmentCommandHandlers } from "./local-attachment-command-handlers";

const createRecordingLocalAttachmentService = () => {
  const calls: Array<{
    method: keyof LocalAttachmentService;
    input: unknown;
  }> = [];
  const promiseService: LocalAttachmentService = {
    stage(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "stage", input });
          return { path: "/tmp/openducktor-local-attachments/staged.txt" };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    resolve(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "resolve", input });
          return { path: "/tmp/openducktor-local-attachments/staged.txt" };
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
  const service = promiseService as LocalAttachmentService;
  return { calls, service };
};
describe("createLocalAttachmentCommandHandlers", () => {
  test("routes local attachment commands to the service", async () => {
    const { calls, service } = createRecordingLocalAttachmentService();
    const router = createHostCommandRouter({
      handlers: createLocalAttachmentCommandHandlers(service),
    });
    await expect(
      router.invoke("workspace_stage_local_attachment", {
        name: "brief.pdf",
        base64Data: "YnJpZWY=",
      }),
    ).resolves.toEqual({ path: "/tmp/openducktor-local-attachments/staged.txt" });
    await expect(
      router.invoke("workspace_resolve_local_attachment_path", { path: "brief.pdf" }),
    ).resolves.toEqual({ path: "/tmp/openducktor-local-attachments/staged.txt" });
    expect(calls).toEqual([
      {
        method: "stage",
        input: { name: "brief.pdf", base64Data: "YnJpZWY=" },
      },
      { method: "resolve", input: { path: "brief.pdf" } },
    ]);
  });
});
