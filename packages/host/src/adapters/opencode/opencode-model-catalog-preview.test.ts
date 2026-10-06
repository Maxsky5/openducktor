import { describe, expect, mock, test } from "bun:test";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { ProcessTreeTerminator } from "../../infrastructure/process/process-tree";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createOpenCodeModelCatalogPreview } from "./opencode-model-catalog-preview";

const executablePath = "/tools/opencode";
const resolved = {
  displayLabel: "OpenCode",
  path: executablePath,
  sourceCategory: "provided_path" as const,
};
const toolDiscovery: ToolDiscoveryPort = {
  discoverTool: () => Effect.succeed(resolved),
  resolveTool: () => Effect.succeed(resolved),
  resolveToolPath: () => Effect.succeed(executablePath),
  validateToolPath: () => Effect.succeed(resolved),
};
const catalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  defaultModelsByProvider: {},
};

const createPreview = (
  overrides: Partial<Parameters<typeof createOpenCodeModelCatalogPreview>[0]> = {},
) =>
  createOpenCodeModelCatalogPreview({
    settingsConfig: createFixedRuntimeSettingsConfig("opencode", executablePath),
    toolDiscovery,
    readEnv: () => process.env,
    portAllocator: () => Effect.succeed(4567),
    ...overrides,
  });

describe("OpenCode model catalog preview lifecycle", () => {
  test("reads the catalog from a private server and releases the child", async () => {
    const children: ChildProcessByStdio<null, Readable, Readable>[] = [];
    const processTreeTerminator: ProcessTreeTerminator = mock(() =>
      Effect.sync(() => {
        children[0]?.kill();
      }),
    );
    const readModelCatalog = mock(async () => catalog);
    const readModels = createPreview({
      processTreeTerminator,
      readinessProbe: () => Effect.succeed(true),
      readModelCatalog,
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        children.push(child);
        return child;
      },
    });

    expect(await Effect.runPromise(readModels(process.cwd()))).toEqual(catalog);
    expect(readModelCatalog).toHaveBeenCalledWith(process.cwd(), "http://127.0.0.1:4567");
    expect(processTreeTerminator).toHaveBeenCalledTimes(1);
    expect(children[0]?.killed).toBe(true);
  });

  test("keeps an early spawn error handled when no process ID is available", async () => {
    const children: ChildProcessByStdio<null, Readable, Readable>[] = [];
    const readModels = createPreview({
      spawnProcess: (_command, _args, options) => {
        const child = spawn(`/missing-opencode-preview-${process.pid}`, [], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure._tag).toBe("HostOperationError");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(children[0]?.listenerCount("error")).toBe(0);
  });

  test("reports a server exit before readiness and releases the child", async () => {
    const children: ChildProcessByStdio<null, Readable, Readable>[] = [];
    const processTreeTerminator: ProcessTreeTerminator = mock(() =>
      Effect.sync(() => {
        children[0]?.kill();
      }),
    );
    const readModels = createPreview({
      processTreeTerminator,
      readinessProbe: () => {
        children[0]?.emit("close", 2);
        return Effect.succeed(false);
      },
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure._tag).toBe("HostOperationError");
    expect(failure).toMatchObject({ operation: "opencodeModelCatalogPreview.start" });
    expect(processTreeTerminator).toHaveBeenCalledTimes(1);
    expect(children[0]?.killed).toBe(true);
  });

  test("bounds a stalled catalog request and releases the child", async () => {
    const children: ChildProcessByStdio<null, Readable, Readable>[] = [];
    const processTreeTerminator: ProcessTreeTerminator = mock(() =>
      Effect.sync(() => {
        children[0]?.kill();
      }),
    );
    const readModels = createPreview({
      processTreeTerminator,
      readinessProbe: () => Effect.succeed(true),
      readModelCatalog: () => new Promise<AgentModelCatalog>(() => {}),
      readTimeoutMs: 20,
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure._tag).toBe("HostOperationError");
    expect(failure).toMatchObject({ operation: "opencodeModelCatalogPreview.read" });
    expect(processTreeTerminator).toHaveBeenCalledTimes(1);
    expect(children[0]?.killed).toBe(true);
  });

  test("reports both a catalog read failure and a cleanup failure", async () => {
    const children: ChildProcessByStdio<null, Readable, Readable>[] = [];
    const processTreeTerminator: ProcessTreeTerminator = () =>
      Effect.sync(() => {
        children[0]?.kill();
      }).pipe(
        Effect.andThen(
          Effect.fail(
            new HostOperationError({
              operation: "test.cleanup",
              message: "OpenCode cleanup failed",
            }),
          ),
        ),
      );
    const readModels = createPreview({
      processTreeTerminator,
      readinessProbe: () => Effect.succeed(true),
      readModelCatalog: async () => {
        throw new Error("OpenCode catalog read failed");
      },
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure.message).toContain("OpenCode catalog read failed");
    expect(failure.message).toContain("OpenCode cleanup failed");
    expect(children[0]?.killed).toBe(true);
  });
});
