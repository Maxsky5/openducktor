import type { TaskAssetReadService } from "@openducktor/host";
import { Effect } from "effect";
import { WebHostRequestError } from "./effect/web-errors";

const TASK_ASSET_PATH_PATTERN = /^\/task-assets\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/;

type TaskAssetHttpServerContext = {
  appToken: string;
  corsHeaders: HeadersInit;
  request: Request;
  taskAssetReadService: TaskAssetReadService;
  validateAppSessionCookie: (
    request: Request,
    expectedToken: string,
  ) => Effect.Effect<void, WebHostRequestError>;
};

const reject = (message: string, status: number): Effect.Effect<never, WebHostRequestError> =>
  Effect.fail(new WebHostRequestError({ message, status }));

export const routeTaskAssetHttpRequest = ({
  appToken,
  corsHeaders,
  request,
  taskAssetReadService,
  validateAppSessionCookie,
}: TaskAssetHttpServerContext): Effect.Effect<Response | null, WebHostRequestError> =>
  Effect.gen(function* () {
    const taskAssetMatch = TASK_ASSET_PATH_PATTERN.exec(new URL(request.url).pathname);
    if (!taskAssetMatch || request.method !== "GET") {
      return null;
    }

    yield* validateAppSessionCookie(request, appToken);
    const [, workspaceId = "", taskId = "", scope = "", assetId = ""] = taskAssetMatch;
    const asset = yield* taskAssetReadService.read({ workspaceId, taskId, scope, assetId }).pipe(
      Effect.mapError(
        (error) =>
          new WebHostRequestError({
            message: error.code === "validation" ? "Task asset was not found." : error.message,
            status: error.code === "validation" ? 404 : 500,
            cause: error,
          }),
      ),
    );
    if (!asset) {
      return yield* reject("Task asset was not found.", 404);
    }

    // SAFETY: The surrounding boundary constructs or validates every member required by `ArrayBuffer`.
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: { ...corsHeaders, ...asset.headers },
    });
  });
