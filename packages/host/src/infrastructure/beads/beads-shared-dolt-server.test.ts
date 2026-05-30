import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { BeadsSharedServerPaths, BeadsSharedServerState } from "./beads-context-model";
import {
  readSharedServerState,
  runCommandAllowFailure,
  serverStateIsHealthy,
  stopOwnedSharedDoltServer,
  writeDoltConfigFile,
  writeSharedServerState,
  yamlQuotePath,
} from "./beads-shared-dolt-server";

const TEST_SHARED_DOLT_TOOL_PATHS = {
  dolt: "dolt",
};

const createPaths = async (): Promise<BeadsSharedServerPaths> => {
  const baseDir = await mkdtemp(path.join(tmpdir(), "odt config shared dolt-"));
  const beadsRoot = path.join(baseDir, "beads");
  const sharedServerRoot = path.join(beadsRoot, "shared server C-Users\\Max Sky");
  return {
    baseDir,
    beadsRoot,
    sharedServerRoot,
    doltRoot: path.join(sharedServerRoot, "dolt data"),
    cfgDir: path.join(sharedServerRoot, ".doltcfg with spaces"),
    doltConfigFile: path.join(sharedServerRoot, "dolt-config.yaml"),
    env: { ...process.env, OPENDUCKTOR_CONFIG_DIR: baseDir },
    serverStatePath: path.join(sharedServerRoot, "server.json"),
    tools: TEST_SHARED_DOLT_TOOL_PATHS,
  };
};

const createState = (
  paths: BeadsSharedServerPaths,
  overrides: Partial<BeadsSharedServerState> = {},
): BeadsSharedServerState => ({
  pid: process.pid,
  host: "127.0.0.1",
  port: 36111,
  user: "root",
  ownerPid: process.pid,
  acquisition: "started_by_owner",
  sharedServerRoot: paths.sharedServerRoot,
  doltDataDir: paths.doltRoot,
  startedAt: "2026-05-10T00:00:00Z",
  ...overrides,
});

const createStopState = (
  overrides: Partial<BeadsSharedServerState> = {},
): BeadsSharedServerState => ({
  pid: 999_999_991,
  ownerPid: process.pid,
  acquisition: "started_by_owner",
  host: "127.0.0.1",
  user: "root",
  port: 36_001,
  sharedServerRoot: "/tmp/odt-shared-dolt",
  doltDataDir: "/tmp/odt-shared-dolt/dolt",
  startedAt: "2026-05-16T00:00:00.000Z",
  ...overrides,
});

describe("readSharedServerState", () => {
  test("preserves path-edge strings from valid server state", async () => {
    const paths = await createPaths();
    const state = createState(paths);
    await Effect.runPromise(writeSharedServerState(paths, state));

    await expect(Effect.runPromise(readSharedServerState(paths.serverStatePath))).resolves.toEqual(
      state,
    );
  });

  test("returns null when server state is absent", async () => {
    const paths = await createPaths();

    await expect(
      Effect.runPromise(readSharedServerState(paths.serverStatePath)),
    ).resolves.toBeNull();
  });

  test("rejects malformed and non-object server state", async () => {
    const paths = await createPaths();
    await mkdir(path.dirname(paths.serverStatePath), { recursive: true });
    await writeFile(paths.serverStatePath, "{broken");

    await expect(Effect.runPromise(readSharedServerState(paths.serverStatePath))).rejects.toThrow(
      `Failed parsing shared Dolt server state ${paths.serverStatePath}`,
    );

    await writeFile(paths.serverStatePath, "[]");
    await expect(Effect.runPromise(readSharedServerState(paths.serverStatePath))).rejects.toThrow(
      `Shared Dolt server state ${paths.serverStatePath} must contain a JSON object`,
    );
  });

  test.each([
    "pid",
    "host",
    "user",
    "port",
    "ownerPid",
    "sharedServerRoot",
    "doltDataDir",
    "startedAt",
  ])("rejects server state missing %s", async (field) => {
    const paths = await createPaths();
    await mkdir(path.dirname(paths.serverStatePath), { recursive: true });
    const state = createState(paths) as Record<string, unknown>;
    delete state[field];
    await writeFile(paths.serverStatePath, JSON.stringify(state));

    await expect(Effect.runPromise(readSharedServerState(paths.serverStatePath))).rejects.toThrow(
      `Shared Dolt server state ${paths.serverStatePath} is missing pid, host, user, port, ownerPid, sharedServerRoot, doltDataDir, or startedAt`,
    );
  });
});

describe("serverStateIsHealthy", () => {
  test("rejects mismatched host, user, shared root, and data dir before probing services", async () => {
    const paths = await createPaths();
    const state = createState(paths);

    await expect(
      Effect.runPromise(serverStateIsHealthy({ ...state, host: "127.0.0.2" }, paths)),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(serverStateIsHealthy({ ...state, user: "other" }, paths)),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(
        serverStateIsHealthy(
          { ...state, sharedServerRoot: `${paths.sharedServerRoot}-other` },
          paths,
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(
        serverStateIsHealthy({ ...state, doltDataDir: `${paths.doltRoot}-other` }, paths),
      ),
    ).resolves.toBe(false);
  });
});

describe("stopOwnedSharedDoltServer", () => {
  test("refuses to stop another owner before touching the state file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-shared-dolt-stop-"));
    const statePath = path.join(root, "server.json");
    await writeFile(statePath, "state");

    await expect(
      Effect.runPromise(
        stopOwnedSharedDoltServer(createStopState({ ownerPid: process.pid + 1 }), statePath),
      ),
    ).rejects.toThrow("Refusing to stop shared Dolt server");

    await expect(readFile(statePath, "utf8")).resolves.toBe("state");
  });

  test("removes state only after the owned process is confirmed gone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-shared-dolt-stop-"));
    const statePath = path.join(root, "server.json");
    await writeFile(statePath, "state");

    await expect(
      Effect.runPromise(stopOwnedSharedDoltServer(createStopState(), statePath)),
    ).resolves.toBeUndefined();
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
  });

  test("keeps state visible when process cleanup fails before termination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-shared-dolt-stop-"));
    const statePath = path.join(root, "server.json");
    await writeFile(statePath, "state");

    await expect(
      Effect.runPromise(stopOwnedSharedDoltServer(createStopState({ pid: 0 }), statePath)),
    ).rejects.toThrow("invalid process pid 0");
    await expect(readFile(statePath, "utf8")).resolves.toBe("state");
  });
});

describe("Dolt config YAML rendering", () => {
  test("quotes filesystem paths with spaces, backslashes, drive-letter text, and single quotes", () => {
    expect(yamlQuotePath("C:\\Users\\Max Sky\\Repo Name")).toBe("'C:\\Users\\Max Sky\\Repo Name'");
    expect(yamlQuotePath("/tmp/OpenDucktor's Config")).toBe("'/tmp/OpenDucktor''s Config'");
  });

  test("writes deterministic quoted paths and leaves no successful temp file", async () => {
    const paths = await createPaths();
    const quotedPaths = {
      doltRoot: yamlQuotePath(paths.doltRoot),
      cfgDir: yamlQuotePath(paths.cfgDir),
      privilegeFile: yamlQuotePath(path.join(paths.cfgDir, "privileges.db")),
      branchControlFile: yamlQuotePath(path.join(paths.cfgDir, "branch_control.db")),
    };

    await Effect.runPromise(writeDoltConfigFile(paths, 36112));

    await expect(readFile(paths.doltConfigFile, "utf8")).resolves.toBe(
      `log_level: info\n` +
        `behavior:\n` +
        `  autocommit: true\n` +
        `listener:\n` +
        `  host: 127.0.0.1\n` +
        `  port: 36112\n` +
        `data_dir: ${quotedPaths.doltRoot}\n` +
        `cfg_dir: ${quotedPaths.cfgDir}\n` +
        `privilege_file: ${quotedPaths.privilegeFile}\n` +
        `branch_control_file: ${quotedPaths.branchControlFile}\n`,
    );
    await expect(readdir(paths.sharedServerRoot)).resolves.not.toContain(
      `dolt-config.yaml.tmp-${process.pid}`,
    );
  });
});

describe("runCommandAllowFailure", () => {
  test("runs Windows cmd launchers through cmd.exe", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "odt-shared-dolt-cmd-"));
    const command = path.join(root, "tool.cmd");
    await writeFile(command, "@echo off\r\necho cmd:%~1:%~2\r\n");

    await expect(
      Effect.runPromise(
        runCommandAllowFailure({
          command,
          args: ["one", "two words"],
          cwd: root,
          env: { ...process.env },
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      stdout: "cmd:one:two words\r\n",
    });
  });
});
