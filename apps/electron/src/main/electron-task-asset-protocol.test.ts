import { describe, expect, test } from "bun:test";
import type { TaskAssetReadService } from "@openducktor/host";
import { TaskAssetError } from "@openducktor/host";
import { Effect } from "effect";
import {
  createElectronTaskAssetUrl,
  ELECTRON_TASK_ASSET_PROTOCOL,
  parseElectronTaskAssetUrl,
} from "../shared/electron-task-asset-url";
import { registerElectronTaskAssetProtocol } from "./electron-task-asset-protocol";

const context = {
  workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
  taskId: "task-1",
  scope: "description" as const,
  assetId: "550e8400-e29b-41d4-a716-446655440000",
};

const register = (readService: TaskAssetReadService) => {
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  registerElectronTaskAssetProtocol({
    readService,
    session: {
      protocol: {
        handle: (scheme, nextHandler) => {
          expect(scheme).toBe(ELECTRON_TASK_ASSET_PROTOCOL);
          handler = nextHandler;
        },
      },
    },
  });
  if (!handler) {
    throw new Error("Task asset protocol handler was not registered.");
  }
  return handler;
};

describe("Electron task asset protocol", () => {
  test("creates and parses only exact application URLs", () => {
    const url = createElectronTaskAssetUrl(context);
    expect(parseElectronTaskAssetUrl(url)).toEqual(context);
    expect(parseElectronTaskAssetUrl(url.replace("description", "spec"))).toBeNull();
    expect(parseElectronTaskAssetUrl(`${ELECTRON_TASK_ASSET_PROTOCOL}://asset/%`)).toBeNull();
    expect(parseElectronTaskAssetUrl("https://example.com/task-assets/x")).toBeNull();
  });

  test("serves authorized bytes with registry-derived headers", async () => {
    let readInput: unknown;
    const handler = register({
      read: (input) => {
        readInput = input;
        return Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="diagram.png"',
            "Content-Type": "image/png",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    });

    const response = await handler(new Request(createElectronTaskAssetUrl(context)));

    expect(response.status).toBe(200);
    expect(readInput).toEqual(context);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("returns 404 for invalid and ownership-mismatched requests", async () => {
    let reads = 0;
    const handler = register({
      read: () => {
        reads += 1;
        return Effect.succeed(null);
      },
    });

    expect((await handler(new Request("https://example.com/forged"))).status).toBe(404);
    expect(reads).toBe(0);
    expect((await handler(new Request(createElectronTaskAssetUrl(context)))).status).toBe(404);
    expect(reads).toBe(1);
  });

  test("does not expose internal read failures", async () => {
    const handler = register({
      read: () =>
        Effect.fail(
          new TaskAssetError({
            operation: "serve",
            code: "database",
            taskId: context.taskId,
            assetIds: [context.assetId],
            failedPhase: "read_registry",
            durableState: "unchanged",
            retryAllowed: false,
            message: "sensitive database detail",
          }),
        ),
    });

    const response = await handler(new Request(createElectronTaskAssetUrl(context)));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive database detail");
  });
});
