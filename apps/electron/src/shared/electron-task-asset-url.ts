import { type TaskAssetRenderContext, taskAssetRenderContextSchema } from "@openducktor/contracts";

export const ELECTRON_TASK_ASSET_PROTOCOL = "openducktor-task-asset";
const ELECTRON_TASK_ASSET_HOST = "asset";

export const createElectronTaskAssetUrl = (input: TaskAssetRenderContext): string => {
  const context = taskAssetRenderContextSchema.parse(input);
  const path = [context.workspaceId, context.taskId, context.scope, context.assetId]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${ELECTRON_TASK_ASSET_PROTOCOL}://${ELECTRON_TASK_ASSET_HOST}/${path}`;
};

export const parseElectronTaskAssetUrl = (requestUrl: string): TaskAssetRenderContext | null => {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${ELECTRON_TASK_ASSET_PROTOCOL}:` ||
    url.hostname !== ELECTRON_TASK_ASSET_HOST
  ) {
    return null;
  }
  const encodedSegments = url.pathname.split("/").filter(Boolean);
  if (encodedSegments.length !== 4) {
    return null;
  }
  try {
    const [workspaceId, taskId, scope, assetId] = encodedSegments.map((segment) =>
      decodeURIComponent(segment),
    );
    const parsed = taskAssetRenderContextSchema.safeParse({ workspaceId, taskId, scope, assetId });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
