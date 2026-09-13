import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createNodeWorkspaceHostOwnership } from "./workspace-host-ownership-adapter";

const ownerPathFor = (configDir: string, workspaceId: string): string =>
  path.join(
    configDir,
    "workspace-host-owners",
    `${createHash("sha256").update(workspaceId).digest("hex")}.json`,
  );

describe("node workspace host ownership", () => {
  test("rejects a workspace claimed by another live process", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const hostRoot = path.resolve(import.meta.dir, "../../..");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `import { Effect } from "effect";
import { createNodeWorkspaceHostOwnership } from "./src/adapters/node/workspace-host-ownership-adapter.ts";
const ownership = createNodeWorkspaceHostOwnership();
await Effect.runPromise(ownership.claimWorkspace("workspace-1"));
console.log("claimed");
setInterval(() => {}, 60_000);`,
      ],
      cwd: hostRoot,
      env: { ...process.env, OPENDUCKTOR_CONFIG_DIR: configDir },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const reader = child.stdout.getReader();
      const firstOutput = await reader.read();
      expect(new TextDecoder().decode(firstOutput.value)).toContain("claimed");
      expect(child.exitCode).toBeNull();
      expect(() => process.kill(child.pid, 0)).not.toThrow();

      const ownership = createNodeWorkspaceHostOwnership({
        processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
      });
      await expect(Effect.runPromise(ownership.claimWorkspace("workspace-1"))).rejects.toThrow(
        `Workspace workspace-1 is in use by another OpenDucktor host process`,
      );
    } finally {
      child.kill();
      await child.exited;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("recovers a stale claim only after it proves that the owner stopped", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    const lockPath = `${ownerPath}.lock`;
    await mkdir(path.dirname(ownerPath), { recursive: true });
    await writeFile(
      ownerPath,
      JSON.stringify({
        version: 1,
        instanceId: "00000000-0000-4000-8000-000000000001",
        processId: 41_001,
        startedAtMs: 1_000,
        workspaceId,
      }),
    );
    await mkdir(lockPath);
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(lockPath, staleTime, staleTime);
    const ownership = createNodeWorkspaceHostOwnership(
      { processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir } },
      {
        identity: {
          instanceId: "00000000-0000-4000-8000-000000000002",
          processId: 41_002,
          startedAtMs: 2_000,
        },
        processIsAlive: () => false,
        processStartedAtMs: async () => {
          throw new Error("A dead owner must not need a start-time probe.");
        },
      },
    );

    try {
      await expect(
        Effect.runPromise(ownership.claimWorkspace(workspaceId)),
      ).resolves.toBeUndefined();
      await expect(Effect.runPromise(ownership.releaseAll())).resolves.toBeUndefined();
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("does not steal a claim when it cannot verify a live owner", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    await mkdir(path.dirname(ownerPath), { recursive: true });
    await writeFile(
      ownerPath,
      JSON.stringify({
        version: 1,
        instanceId: "00000000-0000-4000-8000-000000000001",
        processId: 41_001,
        startedAtMs: 1_000,
        workspaceId,
      }),
    );
    await mkdir(`${ownerPath}.lock`);
    const ownership = createNodeWorkspaceHostOwnership(
      { processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir } },
      {
        identity: {
          instanceId: "00000000-0000-4000-8000-000000000002",
          processId: 41_002,
          startedAtMs: 2_000,
        },
        processIsAlive: () => true,
        processStartedAtMs: async () => {
          throw new Error("process inspection failed");
        },
      },
    );

    try {
      await expect(Effect.runPromise(ownership.claimWorkspace(workspaceId))).rejects.toThrow(
        "Cannot verify the OpenDucktor host",
      );
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });
});
