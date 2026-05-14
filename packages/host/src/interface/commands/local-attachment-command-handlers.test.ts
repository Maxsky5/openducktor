import type { LocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createLocalAttachmentCommandHandlers } from "./local-attachment-command-handlers";

const createRecordingLocalAttachmentService = () => {
  const calls: Array<{ method: keyof LocalAttachmentService; input: unknown }> = [];
  const service: LocalAttachmentService = {
    async stage(input) {
      calls.push({ method: "stage", input });
      return { path: "/tmp/openducktor-local-attachments/staged.txt" };
    },
    async resolve(input) {
      calls.push({ method: "resolve", input });
      return { path: "/tmp/openducktor-local-attachments/staged.txt" };
    },
  };

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
