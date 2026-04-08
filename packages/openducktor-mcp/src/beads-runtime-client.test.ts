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
  return join(root, ".beads");
};

const writeAttachmentMetadata = (
  beadsDir: string,
  databaseName: string,
  port = 3310,
  includeConnectionFields = true,
): void => {
  mkdirSync(beadsDir, { recursive: true });
  const payload: Record<string, unknown> = {
    backend: "dolt",
    dolt_mode: "server",
    dolt_database: databaseName,
  };
  if (includeConnectionFields) {
    payload.dolt_server_host = "127.0.0.1";
    payload.dolt_server_port = port;
    payload.dolt_server_user = "root";
  }
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
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310, false);
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

  test("ensureInitialized bootstraps existing attachments when the shared database is missing", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310, false);
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
                stderr: JSON.stringify({
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
      ["bootstrap", "--yes"],
      ["where", "--json"],
    ]);
  });

  test("ensureInitialized force-restores backups when bootstrap asks for overwrite", async () => {
    const beadsDir = makeTempBeadsDir();
    writeAttachmentMetadata(beadsDir, "odt_fairnest_deadbeefcafe", 3310, false);
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
                stderr: JSON.stringify({
                  error:
                    'failed to open database: database "odt_fairnest_deadbeefcafe" not found on Dolt server at 127.0.0.1:3310',
                }),
              };
            }
            return { ok: true, stdout: JSON.stringify({ path: beadsDir }), stderr: "" };
          }
          if (args[0] === "bootstrap") {
            return {
              ok: false,
              stdout: "",
              stderr:
                "Bootstrap failed: restore from backup: Error 1105: database already exists, use '--force' to overwrite",
            };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
      },
    );

    await client.ensureInitialized();

    expect(calls.map((call) => call.args)).toEqual([
      ["where", "--json"],
      ["bootstrap", "--yes"],
      ["backup", "restore", "--force"],
      ["where", "--json"],
    ]);
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
