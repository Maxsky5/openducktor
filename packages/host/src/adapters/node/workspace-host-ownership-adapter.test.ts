import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  createNodeWorkspaceHostOwnership,
  createNodeWorkspaceOwnershipLock,
} from "./workspace-host-ownership-adapter";

const ownerPathFor = (configDir: string, workspaceId: string): string =>
  path.join(
    configDir,
    "workspace-host-owners",
    `${createHash("sha256").update(workspaceId).digest("hex")}.json`,
  );

describe("node workspace host ownership", () => {
  test("prevents workspace path ownership changes across host processes", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const hostRoot = path.resolve(import.meta.dir, "../../..");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `import { Effect } from "effect";
import { createNodeWorkspaceOwnershipLock } from "./src/adapters/node/workspace-host-ownership-adapter.ts";
const ownershipLock = createNodeWorkspaceOwnershipLock();
await Effect.runPromise(ownershipLock.runExclusive(
  Effect.sync(() => console.log("locked")).pipe(Effect.zipRight(Effect.never)),
));`,
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
      expect(new TextDecoder().decode(firstOutput.value)).toContain("locked");

      const ownershipLock = createNodeWorkspaceOwnershipLock({
        processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
      });
      await expect(Effect.runPromise(ownershipLock.runExclusive(Effect.void))).rejects.toThrow(
        "Another OpenDucktor host owns the workspace path lock",
      );
    } finally {
      child.kill();
      await child.exited;
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("releases workspace path ownership after the protected effect fails", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const ownershipLock = createNodeWorkspaceOwnershipLock({
      processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
    });

    try {
      const result = await Effect.runPromise(
        ownershipLock.runExclusive(Effect.fail("expected failure")).pipe(Effect.either),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBe("expected failure");
      }
      await expect(
        Effect.runPromise(ownershipLock.runExclusive(Effect.void)),
      ).resolves.toBeUndefined();
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

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

  test("releases one workspace for another host", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const options = { processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir } };
    const first = createNodeWorkspaceHostOwnership(options);
    const second = createNodeWorkspaceHostOwnership(options);

    try {
      await expect(Effect.runPromise(first.claimWorkspace("workspace-1"))).resolves.toBe(true);
      await expect(Effect.runPromise(first.claimWorkspace("workspace-1"))).resolves.toBe(false);
      await Effect.runPromise(first.releaseWorkspace("workspace-1"));
      await expect(Effect.runPromise(second.claimWorkspace("workspace-1"))).resolves.toBe(true);
      await Effect.runPromise(second.releaseAll());
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("keeps a partial ownership release actionable", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    const ownership = createNodeWorkspaceHostOwnership({
      processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
    });

    try {
      await Effect.runPromise(ownership.claimWorkspace(workspaceId));
      await writeFile(path.join(`${ownerPath}.lock`, "block-release"), "");

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(Effect.runPromise(ownership.releaseWorkspace(workspaceId))).rejects.toThrow(
          "Restart OpenDucktor, wait 30 seconds, and retry the removal",
        );
      }
    } finally {
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
      await expect(Effect.runPromise(ownership.claimWorkspace(workspaceId))).resolves.toBe(true);
      await expect(Effect.runPromise(ownership.releaseAll())).resolves.toBeUndefined();
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("reports a fresh claim whose owner record is missing", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    await mkdir(`${ownerPath}.lock`, { recursive: true });
    const ownership = createNodeWorkspaceHostOwnership({
      processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
    });

    try {
      await expect(Effect.runPromise(ownership.claimWorkspace(workspaceId))).rejects.toThrow(
        `stopped while publishing ownership for workspace ${workspaceId}. Wait 30 seconds and retry`,
      );
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("gives manual recovery steps for an unreadable owner record", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    await mkdir(path.dirname(ownerPath), { recursive: true });
    await writeFile(ownerPath, "{");
    await mkdir(`${ownerPath}.lock`);
    const ownership = createNodeWorkspaceHostOwnership({
      processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
    });

    try {
      await expect(Effect.runPromise(ownership.claimWorkspace(workspaceId))).rejects.toThrow(
        `Close all OpenDucktor instances, delete ${ownerPath} and ${ownerPath}.lock, then retry`,
      );
    } finally {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("recovers a stale claim whose owner record is missing", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-workspace-owner-"));
    const workspaceId = "workspace-1";
    const ownerPath = ownerPathFor(configDir, workspaceId);
    const lockPath = `${ownerPath}.lock`;
    await mkdir(lockPath, { recursive: true });
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
        processIsAlive: () => {
          throw new Error("A missing owner record must not need a process probe.");
        },
        processStartedAtMs: async () => {
          throw new Error("A missing owner record must not need a start-time probe.");
        },
      },
    );

    try {
      await expect(Effect.runPromise(ownership.claimWorkspace(workspaceId))).resolves.toBe(true);
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
