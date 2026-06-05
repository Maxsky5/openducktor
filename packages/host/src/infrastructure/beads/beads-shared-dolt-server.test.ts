import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { BeadsSharedServerPaths, BeadsSharedServerState } from "./beads-context-model";
import { readSelectedDoltVersion, serverStateIsHealthy } from "./beads-shared-dolt-health";
import {
  defaultEnsureSharedDoltServerRunning,
  readSharedServerState,
  runCommandAllowFailure,
  stopOwnedSharedDoltServer,
} from "./beads-shared-dolt-server";
import { writeDoltConfigFile } from "./beads-shared-dolt-startup";
import { writeSharedServerState } from "./beads-shared-dolt-state";

const TEST_SHARED_DOLT_TOOL_PATHS = {
  dolt: "dolt",
  selectedDoltVersion: "2.1.2",
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

const expectedYamlQuotedPath = (inputPath: string): string =>
  `'${inputPath.replaceAll("'", "''")}'`;

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const spawnLongRunningProcess = async (): Promise<number> => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) {
    throw new Error("Test process started without a pid.");
  }
  child.unref();
  return child.pid;
};

const stopTestProcess = async (pid: number): Promise<void> => {
  if (!processIsRunning(pid)) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Best-effort cleanup for failed tests.
    }
  }
};

const createFakeDoltCommand = async ({
  selectedVersion,
  serverVersion,
}: {
  selectedVersion: string;
  serverVersion: string;
}): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-fake-dolt-"));
  if (process.platform === "win32") {
    const command = path.join(root, "dolt.cmd");
    await writeFile(
      command,
      [
        "@echo off",
        'if "%~1"=="version" (',
        `  echo dolt version ${selectedVersion}`,
        "  exit /b 0",
        ")",
        'echo %* | findstr /C:"select dolt_version();" >nul',
        "if not errorlevel 1 (",
        "  echo dolt_version()",
        `  echo ${serverVersion}`,
        "  exit /b 0",
        ")",
        'echo %* | findstr /C:"show databases" >nul',
        "if not errorlevel 1 exit /b 0",
        "exit /b 1",
        "",
      ].join("\r\n"),
    );
    return command;
  }

  const command = path.join(root, "dolt");
  await writeFile(
    command,
    `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "dolt version ${selectedVersion}"
  exit 0
fi

case " $* " in
  *"select dolt_version();"*)
    printf 'dolt_version()\\n${serverVersion}\\n'
    exit 0
    ;;
  *"show databases"*)
    exit 0
    ;;
esac

exit 1
`,
  );
  await chmod(command, 0o755);
  return command;
};

const withTcpServer = async <T>(fn: (port: number) => Promise<T>): Promise<T> => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test TCP server did not expose a port.");
    }
    return await fn(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

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
  test("reads the selected Dolt binary version once from the configured command", async () => {
    const fakeDolt = await createFakeDoltCommand({
      selectedVersion: "2.1.2",
      serverVersion: "2.1.2",
    });

    await expect(Effect.runPromise(readSelectedDoltVersion(fakeDolt, process.env))).resolves.toBe(
      "2.1.2",
    );
  });

  test("rejects mismatched host, user, shared root, and data dir before probing services", async () => {
    const paths = await createPaths();
    const state = createState(paths);

    await expect(
      Effect.runPromise(serverStateIsHealthy({ ...state, host: "127.0.0.2" }, paths, "2.1.2")),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(serverStateIsHealthy({ ...state, user: "other" }, paths, "2.1.2")),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(
        serverStateIsHealthy(
          { ...state, sharedServerRoot: `${paths.sharedServerRoot}-other` },
          paths,
          "2.1.2",
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(
        serverStateIsHealthy({ ...state, doltDataDir: `${paths.doltRoot}-other` }, paths, "2.1.2"),
      ),
    ).resolves.toBe(false);
  });

  test("rejects a reachable server running a stale Dolt version", async () => {
    const paths = await createPaths();
    const fakeDolt = await createFakeDoltCommand({
      selectedVersion: "2.1.2",
      serverVersion: "1.86.0",
    });

    await withTcpServer(async (port) => {
      const state = createState(paths, { port });

      await expect(
        Effect.runPromise(
          serverStateIsHealthy(
            state,
            {
              ...paths,
              tools: { dolt: fakeDolt, selectedDoltVersion: "2.1.2" },
            },
            "2.1.2",
          ),
        ),
      ).resolves.toBe(false);
    });
  });

  test("accepts a reachable server matching the selected Dolt version", async () => {
    const paths = await createPaths();
    const fakeDolt = await createFakeDoltCommand({
      selectedVersion: "2.1.2",
      serverVersion: "2.1.2",
    });

    await withTcpServer(async (port) => {
      const state = createState(paths, { port });

      await expect(
        Effect.runPromise(
          serverStateIsHealthy(
            state,
            {
              ...paths,
              tools: { dolt: fakeDolt, selectedDoltVersion: "2.1.2" },
            },
            "2.1.2",
          ),
        ),
      ).resolves.toBe(true);
    });
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

describe("defaultEnsureSharedDoltServerRunning", () => {
  test("refuses to replace an unhealthy server owned by another live process", async () => {
    const paths = await createPaths();
    const fakeDolt = await createFakeDoltCommand({
      selectedVersion: "2.1.2",
      serverVersion: "1.86.0",
    });
    const ownerPid = await spawnLongRunningProcess();
    const state = createState(paths, { ownerPid, pid: 999_999_992 });
    await Effect.runPromise(writeSharedServerState(paths, state));

    try {
      await expect(
        Effect.runPromise(
          defaultEnsureSharedDoltServerRunning({
            ...paths,
            tools: { dolt: fakeDolt, selectedDoltVersion: "2.1.2" },
          }),
        ),
      ).rejects.toThrow(`still owned by live pid ${ownerPid}`);
      await expect(
        Effect.runPromise(readSharedServerState(paths.serverStatePath)),
      ).resolves.toMatchObject({ ownerPid });
    } finally {
      await stopTestProcess(ownerPid);
    }
  });
});

describe("Dolt config YAML rendering", () => {
  test("writes deterministic quoted paths and leaves no successful temp file", async () => {
    const paths = await createPaths();
    const quotedPaths = {
      doltRoot: expectedYamlQuotedPath(paths.doltRoot),
      cfgDir: expectedYamlQuotedPath(paths.cfgDir),
      privilegeFile: expectedYamlQuotedPath(path.join(paths.cfgDir, "privileges.db")),
      branchControlFile: expectedYamlQuotedPath(path.join(paths.cfgDir, "branch_control.db")),
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
