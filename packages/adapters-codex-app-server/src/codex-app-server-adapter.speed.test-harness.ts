import { codexAppServerRequestParamsSchemas } from "@openducktor/contracts";
import { RecordingTransport } from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest } from "./index";
import type { CodexModelListResponse } from "./types";

export class FastTransport extends RecordingTransport {
  extraModels: string[] = [];
  resumedTier: string | null = "default";
  onSettingsUpdate: (tier: string | null, threadId: string) => void = () => {};
  override async request(request: CodexJsonRpcRequest) {
    const response = await super.request(request);
    if (request.method === "thread/settings/update") {
      const settings = codexAppServerRequestParamsSchemas["thread/settings/update"].parse(
        request.params,
      );
      this.onSettingsUpdate(settings.serviceTier ?? "default", settings.threadId);
    }
    if (request.method === "model/list") {
      // SAFETY: RecordingTransport returns its model-list fixture for this method.
      const catalog = response as CodexModelListResponse;
      return {
        ...catalog,
        data: catalog.data
          .flatMap((model) => [
            model,
            ...this.extraModels.map((id) => ({ ...model, id, model: id })),
          ])
          .map((model) => ({
            ...model,
            serviceTiers: [
              { id: "priority-example", name: "Fast", description: "Fast processing" },
              { id: "ultrafast", name: "Ultrafast", description: "Ultrafast processing" },
              { id: "future-speed", name: "Future speed", description: "New processing level" },
            ],
          })),
      };
    }
    if (request.method === "thread/resume" && !("serviceTier" in request.params))
      return { ...response, serviceTier: this.resumedTier };
    if (
      request.method === "thread/start" ||
      request.method === "thread/fork" ||
      request.method === "thread/resume"
    )
      return { ...response, serviceTier: request.params.serviceTier ?? "default" };
    return response;
  }
}

export const settingsReport = (
  serviceTier: string | null,
  threadId = "thread/start-runtime-live",
  model = "gpt-5",
  effort: string | null = null,
) => ({
  method: "thread/settings/updated",
  params: {
    threadId,
    threadSettings: {
      cwd: "/repo",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "dangerFullAccess" },
      activePermissionProfile: null,
      model,
      modelProvider: "openai",
      serviceTier,
      effort,
      summary: null,
      collaborationMode: {
        mode: "default",
        settings: { model, reasoning_effort: effort, developer_instructions: null },
      },
      personality: null,
    },
  },
});
