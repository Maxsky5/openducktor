import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBeadsDatabaseName } from "./beads-runtime";
import { BeadsRuntimeClient } from "./beads-runtime-client";

type ProcessCall = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

const tempRoots: string[] = [];

const makeTempBeadsDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), "odt-beads-runtime-client-"));
  tempRoots.push(root);
  return join(root, ".beads");
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("BeadsRuntimeClient", () => {
  test("ensureInitialized initializes missing stores and starts dolt", async () => {
    const beadsDir = makeTempBeadsDir();
    const databaseName = await computeBeadsDatabaseName("/repo/fairnest", beadsDir);
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient("/repo/fairnest", beadsDir, {
      runProcess: async (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env });
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([
      ["init", "--quiet", "--skip-hooks", "--prefix", "fairnest", "--database", databaseName],
      ["dolt", "start"],
    ]);
    expect(calls.every((call) => call.command === "bd")).toBe(true);
    expect(calls.every((call) => call.cwd === "/repo/fairnest")).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DIR === beadsDir)).toBe(true);
  });

  test("ensureInitialized skips init when dolt store already exists", async () => {
    const beadsDir = makeTempBeadsDir();
    mkdirSync(join(beadsDir, "dolt"), { recursive: true });
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient("/repo/fairnest", beadsDir, {
      runProcess: async (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env });
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([["dolt", "start"]]);
  });

  test("ensureCustomStatuses is lazy and runs once", async () => {
    const beadsDir = makeTempBeadsDir();
    mkdirSync(join(beadsDir, "dolt"), { recursive: true });
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient("/repo/fairnest", beadsDir, {
      runProcess: async (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env });
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    await client.ensureCustomStatuses();
    await client.ensureCustomStatuses();

    expect(calls.map((call) => call.args)).toEqual([
      ["dolt", "start"],
      ["config", "set", "status.custom", "spec_ready,ready_for_dev,ai_review,human_review"],
    ]);
  });

  test("updateTask configures custom statuses only for custom workflow states", async () => {
    const beadsDir = makeTempBeadsDir();
    mkdirSync(join(beadsDir, "dolt"), { recursive: true });
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient("/repo/fairnest", beadsDir, {
      runProcess: async (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env });
        return { ok: true, stdout: "{}", stderr: "" };
      },
    });

    await client.updateTask(["update", "task-1", "--status", "spec_ready"]);
    await client.updateTask(["update", "task-1", "--status", "blocked"]);

    expect(calls.map((call) => call.args)).toEqual([
      ["dolt", "start"],
      ["config", "set", "status.custom", "spec_ready,ready_for_dev,ai_review,human_review"],
      ["update", "task-1", "--status", "spec_ready", "--json"],
      ["update", "task-1", "--status", "blocked", "--json"],
    ]);
  });
});
