import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  return join(root, "beads", "repo-123", ".beads");
};

const sharedDoltRootFor = (beadsDir: string): string =>
  join(dirname(dirname(beadsDir)), "shared-server", "dolt");

const writeAttachmentMetadata = (beadsDir: string, databaseName: string, port = 3310): void => {
  mkdirSync(beadsDir, { recursive: true });
  const payload: Record<string, unknown> = {
    backend: "dolt",
    dolt_mode: "server",
    dolt_server_host: "127.0.0.1",
    dolt_server_port: port,
    dolt_server_user: "root",
    dolt_database: databaseName,
  };
  writeFileSync(join(beadsDir, "metadata.json"), JSON.stringify(payload));
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("BeadsRuntimeClient", () => {
  test("ensureInitialized initializes missing stores against the shared server", async () => {
    const beadsDir = makeTempBeadsDir();
    const databaseName = await computeBeadsDatabaseName("/repo/fairnest");
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName,
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "init") {
            writeAttachmentMetadata(beadsDir, databaseName);
          }
          if (args[0] === "where") {
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([
      [
        "init",
        "--server",
        "--server-host",
        "127.0.0.1",
        "--server-port",
        "3310",
        "--server-user",
        "root",
        "--quiet",
        "--skip-hooks",
        "--skip-agents",
        "--prefix",
        "fairnest",
        "--database",
        databaseName,
      ],
      ["where", "--json"],
    ]);
    expect(calls.every((call) => call.command === "bd")).toBe(true);
    expect(calls.every((call) => call.cwd === dirname(beadsDir))).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DIR === beadsDir)).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DOLT_SERVER_MODE === "1")).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DOLT_SERVER_HOST === "127.0.0.1")).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DOLT_SERVER_PORT === "3310")).toBe(true);
    expect(calls.every((call) => call.env.BEADS_DOLT_SERVER_USER === "root")).toBe(true);
  });

  test("ensureInitialized reuses an attachment only when verification passes", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310);
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "where") {
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([["where", "--json"]]);
  });

  test("ensureInitialized restores missing shared databases from the attachment backup", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310);
    mkdirSync(join(beadsDir, "backup"), { recursive: true });
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "where") {
            if (calls.filter((call) => call.args[0] === "where").length === 1) {
              return {
                ok: false,
                stdout: "",
                stderr:
                  "Warning: delayed Dolt wake-up\n" +
                  JSON.stringify({
                    error:
                      'failed to open database: database "odt_fairnest_deadbeefcafe" not found on Dolt server at 127.0.0.1:3310',
                  }),
              };
            }
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([
      ["where", "--json"],
      ["backup", "restore", `file://${join(beadsDir, "backup")}`, "odt_fairnest_deadbeefcafe"],
      ["where", "--json"],
    ]);
    expect(calls[1]?.command).toBe("dolt");
    expect(calls[1]?.cwd).toBe(sharedDoltRootFor(beadsDir));
    expect(calls[1]?.env).toEqual({});
  });

  test("ensureInitialized errors when the shared database is missing and no backup exists", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310);
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "where") {
            return {
              ok: false,
              stdout: "",
              stderr: JSON.stringify({
                error:
                  'failed to open database: database "odt_fairnest_deadbeefcafe" not found on Dolt server at 127.0.0.1:3310',
              }),
            };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await expect(client.ensureInitialized()).rejects.toThrow(
      `Shared Dolt database is missing for ${beadsDir} and no attachment backup exists at ${join(beadsDir, "backup")}`,
    );
    expect(calls.map((call) => call.args)).toEqual([["where", "--json"]]);
  });

  test("ensureInitialized repairs mismatched attachment metadata", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_wrong_db");
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          if (args[0] === "init") {
            writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe");
          }
          if (args[0] === "where") {
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          calls.push({ command, args: [...args], cwd, env });
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([
      [
        "init",
        "--server",
        "--server-host",
        "127.0.0.1",
        "--server-port",
        "3310",
        "--server-user",
        "root",
        "--quiet",
        "--skip-hooks",
        "--skip-agents",
        "--prefix",
        "fairnest",
        "--database",
        "odt_fairnest_deadbeefcafe",
      ],
    ]);
  });

  test("ensureCustomStatuses is lazy and runs once", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe");
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "where") {
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureCustomStatuses();
    await client.ensureCustomStatuses();

    expect(calls.map((call) => call.args)).toEqual([
      ["where", "--json"],
      ["config", "set", "status.custom", "spec_ready,ready_for_dev,ai_review,human_review"],
    ]);
  });

  test("updateTask configures custom statuses only for custom workflow states", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe");
    const calls: ProcessCall[] = [];
    const client = new BeadsRuntimeClient(
      "/repo/fairnest",
      {
        beadsAttachmentDir: beadsDir,
        doltHost: "127.0.0.1",
        doltPort: "3310",
        databaseName: "odt_fairnest_deadbeefcafe",
      },
      {
        runProcess: async (command, args, cwd, env) => {
          calls.push({ command, args: [...args], cwd, env });
          if (args[0] === "where") {
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          return { ok: true, stdout: "{}", stderr: "" };
        },
      },
    );

    await client.updateTask(["update", "task-1", "--status", "spec_ready"]);
    await client.updateTask(["update", "task-1", "--status", "blocked"]);

    expect(calls.map((call) => call.args)).toEqual([
      ["where", "--json"],
      ["config", "set", "status.custom", "spec_ready,ready_for_dev,ai_review,human_review"],
      ["update", "task-1", "--status", "spec_ready", "--json"],
      ["update", "task-1", "--status", "blocked", "--json"],
    ]);
  });
});
