import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createSharedDoltToolPathResolver } from "./beads-tool-paths";
import { createFakeDolt } from "./test-support/beads-test-support";

const tempDirectories = new Set<string>();

const makeFakeDoltCommand = async (version: string): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-tool-paths-dolt-"));
  tempDirectories.add(root);
  return createFakeDolt(root, version);
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (tempDirectory) =>
      rm(tempDirectory, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

describe("createSharedDoltToolPathResolver", () => {
  test("captures the selected Dolt binary version with the resolved path", async () => {
    const dolt = await makeFakeDoltCommand("2.1.2");
    const toolDiscovery: ToolDiscoveryPort = {
      resolveTool: () =>
        Effect.succeed({
          displayLabel: "Test Dolt",
          path: dolt,
          sourceCategory: "system_path",
        }),
      resolveToolPath: () => Effect.succeed(dolt),
    };

    await expect(
      Effect.runPromise(createSharedDoltToolPathResolver(toolDiscovery, process.env)()),
    ).resolves.toEqual({
      dolt,
      selectedDoltVersion: "2.1.2",
    });
  });
});
