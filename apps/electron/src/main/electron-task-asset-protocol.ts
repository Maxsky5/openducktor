import type { TaskAssetReadService } from "@openducktor/host";
import { Cause, Chunk, Effect, Exit, Option } from "effect";
import {
  ELECTRON_TASK_ASSET_PROTOCOL,
  parseElectronTaskAssetUrl,
} from "../shared/electron-task-asset-url";

type ElectronTaskAssetSession = {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
  };
};

const errorResponse = (status: 404 | 500): Response =>
  new Response(status === 404 ? "Task asset was not found." : "Task asset could not be read.", {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const registerElectronTaskAssetProtocol = (input: {
  readService: TaskAssetReadService;
  session: ElectronTaskAssetSession;
}): void => {
  input.session.protocol.handle(ELECTRON_TASK_ASSET_PROTOCOL, async (request) => {
    const context = parseElectronTaskAssetUrl(request.url);
    if (!context) {
      return errorResponse(404);
    }
    const exit = await Effect.runPromiseExit(input.readService.read(context));
    if (Exit.isSuccess(exit)) {
      if (!exit.value) {
        return errorResponse(404);
      }
      const body = exit.value.bytes.buffer.slice(
        exit.value.bytes.byteOffset,
        exit.value.bytes.byteOffset + exit.value.bytes.byteLength,
      ) as ArrayBuffer;
      return new Response(body, { headers: exit.value.headers });
    }
    const firstFailure = Chunk.head(Cause.failures(exit.cause));
    if (Option.isSome(firstFailure) && firstFailure.value.code === "validation") {
      return errorResponse(404);
    }
    return errorResponse(500);
  });
};
