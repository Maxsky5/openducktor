import { describe, expect, mock, test } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { ProcessTreeTerminator } from "../../infrastructure/process/process-tree";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import type { CodexChildProcess } from "./codex-runtime-cleanup";
import { createCodexModelCatalogPreview } from "./codex-model-catalog-preview";

const executablePath = join(process.cwd(), `missing-codex-preview-${process.pid}`);
const createToolDiscovery = (): ToolDiscoveryPort => {
  const resolved = {
    displayLabel: "Codex",
    path: executablePath,
    sourceCategory: "provided_path" as const,
  };
  return {
    discoverTool: () => Effect.succeed(resolved),
    resolveTool: () => Effect.succeed(resolved),
    resolveToolPath: () => Effect.succeed(executablePath),
    validateToolPath: () => Effect.succeed(resolved),
  };
};

const createPreview = (
  overrides: Partial<Parameters<typeof createCodexModelCatalogPreview>[0]> = {},
) =>
  createCodexModelCatalogPreview({
    settingsConfig: createFixedRuntimeSettingsConfig("codex", executablePath),
    toolDiscovery: createToolDiscovery(),
    processEnv: process.env,
    clientVersion: "test",
    ...overrides,
  });

test("a failed Codex preview spawn reports an error without crashing the host", async () => {
  const readModels = createPreview();

  const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));
  expect(failure._tag).toBe("HostOperationError");
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe("Codex model catalog preview lifecycle", () => {
  const serverScript = (answerModels: boolean) => `
    let input = "";
    process.stdin.on("data", (chunk) => {
      input += chunk.toString();
      while (input.includes("\\n")) {
        const end = input.indexOf("\\n");
        const line = input.slice(0, end);
        input = input.slice(end + 1);
        const request = JSON.parse(line);
        if (request.method === "initialize") {
          process.stdout.write(JSON.stringify({ id: request.id, result: {
            codexHome: "/tmp", platformFamily: "unix", platformOs: "linux", userAgent: "test"
          } }) + "\\n");
        }
        if (request.method === "model/list" && ${answerModels}) {
          process.stdout.write(JSON.stringify({ id: request.id, result: {
            data: [], nextCursor: null
          } }) + "\\n");
        }
      }
    });
  `;

  test("reads the catalog and releases its transport and child", async () => {
    const children: CodexChildProcess[] = [];
    const processTreeTerminator: ProcessTreeTerminator = mock(() =>
      Effect.sync(() => {
        children[0]?.kill();
      }),
    );
    const readModels = createPreview({
      processTreeTerminator,
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", serverScript(true)], options);
        children.push(child);
        return child;
      },
    });

    const catalog = await Effect.runPromise(readModels(process.cwd()));

    expect(catalog.models).toEqual([]);
    expect(processTreeTerminator).toHaveBeenCalledTimes(1);
    expect(children[0]?.stdin.destroyed).toBe(true);
    expect(children[0]?.killed).toBe(true);
  });

  test("times out an unanswered model read and still releases the child", async () => {
    const children: CodexChildProcess[] = [];
    const processTreeTerminator: ProcessTreeTerminator = mock(() =>
      Effect.sync(() => {
        children[0]?.kill();
      }),
    );
    const readModels = createPreview({
      processTreeTerminator,
      requestTimeoutMs: 500,
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", serverScript(false)], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure._tag).toBe("HostOperationError");
    expect(processTreeTerminator).toHaveBeenCalledTimes(1);
    expect(children[0]?.stdin.destroyed).toBe(true);
    expect(children[0]?.killed).toBe(true);
  });

  test("reports both a model read failure and a cleanup failure", async () => {
    const children: CodexChildProcess[] = [];
    const processTreeTerminator: ProcessTreeTerminator = () =>
      Effect.sync(() => {
        children[0]?.kill();
      }).pipe(
        Effect.zipRight(
          Effect.fail(
            new HostOperationError({
              operation: "test.cleanup",
              message: "Codex cleanup failed",
            }),
          ),
        ),
      );
    const readModels = createPreview({
      processTreeTerminator,
      requestTimeoutMs: 500,
      spawnProcess: (_command, _args, options) => {
        const child = spawn(process.execPath, ["-e", serverScript(false)], options);
        children.push(child);
        return child;
      },
    });

    const failure = await Effect.runPromise(Effect.flip(readModels(process.cwd())));

    expect(failure.message).toContain("model/list");
    expect(failure.message).toContain("Codex cleanup failed");
    expect(children[0]?.killed).toBe(true);
  });
});
