import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeMissingAttachment } from "../../infrastructure/beads/beads-attachment-provisioning";
import { databaseNameForWorkspace } from "../../infrastructure/beads/beads-context-model";
import { ensureSharedDoltServerRunning } from "../../infrastructure/beads/beads-shared-dolt-server";
import {
  type BeadsCliContext,
  type BeadsSharedServerPaths,
  createBeadsAttachmentProvisioner,
  type EnsureSharedDoltServer,
  resolveBeadsCliContext,
  sharedServerHealthFromContext,
} from "./beads-cli-context";

const createSharedServerRecord = (
  sharedServerRoot: string,
  overrides: Partial<NonNullable<BeadsCliContext["sharedServer"]>> = {},
): NonNullable<BeadsCliContext["sharedServer"]> => ({
  pid: 123,
  ownerPid: process.pid,
  acquisition: "started_by_owner",
  host: "127.0.0.1",
  user: "root",
  port: 36001,
  sharedServerRoot,
  doltDataDir: path.join(sharedServerRoot, "dolt"),
  startedAt: "2026-05-10T00:00:00Z",
  ...overrides,
});

const withEnv = async <T>(
  key: string,
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> => {
  const previous = process.env[key];
  try {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
};

describe("resolveBeadsCliContext", () => {
  test("resolves repo-scoped managed Beads paths and server environment", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-config-test-"));
    const repoRoot = await mkdtemp(path.join(tmpdir(), "My Repo-"));
    const serverRoot = path.join(configRoot, "beads", "shared-server");
    await mkdir(serverRoot, { recursive: true });
    await writeFile(
      path.join(serverRoot, "server.json"),
      JSON.stringify(createSharedServerRecord(serverRoot)),
    );

    const canonicalRepoRoot = await realpath(repoRoot);
    const context = await withEnv("OPENDUCKTOR_CONFIG_DIR", configRoot, () =>
      resolveBeadsCliContext(repoRoot, {
        requireSharedServer: true,
        async ensureSharedServer(paths) {
          return createSharedServerRecord(paths.sharedServerRoot, {
            doltDataDir: paths.doltRoot,
          });
        },
        ensureAttachment: async () => undefined,
      }),
    );

    expect(context.repoPath).toBe(canonicalRepoRoot);
    expect(context.repoId).toMatch(/^my-repo-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(context.databaseName).toMatch(/^odt_my_repo_[a-z0-9]+_[a-f0-9]{12}$/);
    expect(context.attachmentRoot).toBe(path.join(configRoot, "beads", context.repoId));
    expect(context.beadsDir).toBe(path.join(context.attachmentRoot, ".beads"));
    expect(context.workingDir).toBe(context.attachmentRoot);
    expect(context.env.BEADS_DIR).toBe(context.beadsDir);
    expect(context.env.BEADS_DOLT_SERVER_MODE).toBe("1");
    expect(context.env.BEADS_DOLT_SERVER_HOST).toBe("127.0.0.1");
    expect(context.env.BEADS_DOLT_SERVER_PORT).toBe("36001");
    expect(context.env.BEADS_DOLT_SERVER_USER).toBe("root");
    expect(sharedServerHealthFromContext(context)).toEqual({
      host: "127.0.0.1",
      port: 36001,
      ownershipState: "owned_by_current_process",
    });
  });

  test("resolves workspace-scoped managed Beads paths when workspace id is provided", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-config-workspace-test-"));
    const repoRoot = await mkdtemp(path.join(tmpdir(), "My Repo-"));
    const canonicalRepoRoot = await realpath(repoRoot);

    const context = await withEnv("OPENDUCKTOR_CONFIG_DIR", configRoot, () =>
      resolveBeadsCliContext(repoRoot, {
        requireSharedServer: false,
        workspaceId: "openducktor",
      }),
    );

    expect(context.repoPath).toBe(canonicalRepoRoot);
    expect(context.repoId).toBe("openducktor");
    expect(context.databaseName).toBe("odt_openducktor_14ecb05f675c");
    expect(context.attachmentRoot).toBe(path.join(configRoot, "beads", "openducktor"));
    expect(context.beadsDir).toBe(path.join(configRoot, "beads", "openducktor", ".beads"));
    expect(context.workingDir).toBe(context.attachmentRoot);
  });

  test("keeps configured workspace identity stable across repo path spelling changes", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt config workspace stable-"));
    const processEnv = { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot };
    const workspaceId = "  Workspace With Spaces  ";
    const repoPaths = [
      path.join(await mkdtemp(path.join(tmpdir(), "Repo With Spaces-")), "Case Path"),
      path.join(
        await mkdtemp(path.join(tmpdir(), "Repo With Backslashes-")),
        "C:\\Users\\Max Sky\\Repo Name",
      ),
      path.join(await mkdtemp(path.join(tmpdir(), "repo-case-")), "Repo Name"),
    ];

    const contexts = await Promise.all(
      repoPaths.map((repoPath) =>
        resolveBeadsCliContext(repoPath, {
          processEnv,
          requireSharedServer: false,
          workspaceId,
        }),
      ),
    );

    for (const context of contexts) {
      expect(context.repoId).toBe("Workspace With Spaces");
      expect(context.databaseName).toBe(databaseNameForWorkspace(workspaceId));
      expect(context.attachmentRoot).toBe(path.join(configRoot, "beads", "Workspace With Spaces"));
      expect(context.beadsDir).toBe(path.join(context.attachmentRoot, ".beads"));
      expect(context.workingDir).toBe(context.attachmentRoot);
    }
  });

  test("derives repo identity from canonical existing paths and absolute synthetic paths", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt config repo identity-"));
    const existingRepo = await mkdtemp(path.join(tmpdir(), "Repo With Spaces-"));
    const canonicalExistingRepo = await realpath(existingRepo);
    const processEnv = { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot };

    const existingContext = await resolveBeadsCliContext(existingRepo, {
      processEnv,
      requireSharedServer: false,
    });

    expect(existingContext.repoPath).toBe(canonicalExistingRepo);
    expect(existingContext.repoId).toMatch(/^repo-with-spaces-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(existingContext.databaseName).toMatch(/^odt_repo_with_spaces_[a-z0-9]+_[a-f0-9]{12}$/);

    const syntheticRepo = path.join(configRoot, "missing repos", "C:\\Users\\Max Sky\\Repo Name");
    const syntheticContext = await resolveBeadsCliContext(syntheticRepo, {
      processEnv,
      requireSharedServer: false,
    });

    expect(syntheticContext.repoPath).toBe(syntheticRepo);
    expect(syntheticContext.repoId).toMatch(/^c-users-max-sky-repo-name-[a-f0-9]{8}$/);
    expect(syntheticContext.databaseName).toMatch(/^odt_c_users_max_sky_repo_name_[a-f0-9]{12}$/);
  });

  test("treats case-different repo spellings as distinct when no workspace id is configured", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt config case identity-"));
    const processEnv = { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot };
    const lowerRepo = path.join(configRoot, "missing repos", "repo name");
    const upperRepo = path.join(configRoot, "missing repos", "Repo Name");

    const [lowerContext, upperContext] = await Promise.all([
      resolveBeadsCliContext(lowerRepo, { processEnv, requireSharedServer: false }),
      resolveBeadsCliContext(upperRepo, { processEnv, requireSharedServer: false }),
    ]);

    expect(lowerContext.repoPath).toBe(lowerRepo);
    expect(upperContext.repoPath).toBe(upperRepo);
    expect(lowerContext.repoId).not.toBe(upperContext.repoId);
    expect(lowerContext.databaseName).not.toBe(upperContext.databaseName);
  });

  test("keeps managed paths under config roots with path-edge names", async () => {
    const configRoot = await mkdtemp(
      path.join(tmpdir(), "odt config C:\\Users\\Max Sky\\OpenDucktor-"),
    );
    const repoRoot = await mkdtemp(path.join(tmpdir(), "Repo With Spaces-"));
    const processEnv = { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot };

    const context = await resolveBeadsCliContext(repoRoot, {
      processEnv,
      requireSharedServer: false,
      workspaceId: "workspace-id",
    });

    expect(context.attachmentRoot).toBe(path.join(configRoot, "beads", "workspace-id"));
    expect(context.beadsDir).toBe(path.join(configRoot, "beads", "workspace-id", ".beads"));
    expect(context.serverStatePath).toBe(
      path.join(configRoot, "beads", "shared-server", "server.json"),
    );
  });

  test("rejects an empty configured OpenDucktor config dir", async () => {
    await expect(
      resolveBeadsCliContext("/repo", {
        processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: "" },
        requireSharedServer: false,
      }),
    ).rejects.toThrow("OPENDUCKTOR_CONFIG_DIR is set but empty");
  });

  test("starts shared Dolt when task commands require a shared server", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-config-missing-server-test-"));
    const repoRoot = await mkdtemp(path.join(tmpdir(), "Repo-"));
    const calls: string[] = [];
    const attachmentCalls: string[] = [];

    const context = await withEnv("OPENDUCKTOR_CONFIG_DIR", configRoot, () =>
      resolveBeadsCliContext(repoRoot, {
        requireSharedServer: true,
        async ensureSharedServer(paths) {
          calls.push(paths.sharedServerRoot);
          return createSharedServerRecord(paths.sharedServerRoot, {
            pid: process.pid,
            port: 36002,
            doltDataDir: paths.doltRoot,
          });
        },
        async ensureAttachment(context) {
          attachmentCalls.push(context.beadsDir);
        },
      }),
    );

    expect(calls).toEqual([path.join(configRoot, "beads", "shared-server")]);
    expect(attachmentCalls).toEqual([context.beadsDir]);
    expect(context.sharedServer).toMatchObject({
      host: "127.0.0.1",
      port: 36002,
      ownerPid: process.pid,
    });
    expect(context.env.BEADS_DOLT_SERVER_PORT).toBe("36002");
  });

  test("builds Beads env and working directory from path-edge shared server state", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt config shared env-"));
    const repoRoot = await mkdtemp(path.join(tmpdir(), "Repo With Spaces-"));
    const serverRoot = path.join(configRoot, "beads", "shared-server");
    const state = createSharedServerRecord(serverRoot, {
      port: 36123,
      sharedServerRoot: path.join(serverRoot, "C:\\Users\\Max Sky\\server"),
      doltDataDir: path.join(serverRoot, "C:\\Users\\Max Sky\\server", "dolt data"),
    });
    await mkdir(serverRoot, { recursive: true });
    await writeFile(path.join(serverRoot, "server.json"), JSON.stringify(state));

    const context = await resolveBeadsCliContext(repoRoot, {
      processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot },
      requireSharedServer: false,
      workspaceId: "workspace with spaces",
    });

    expect(context.workingDir).toBe(context.attachmentRoot);
    expect(context.env.BEADS_DIR).toBe(context.beadsDir);
    expect(context.env.BEADS_DOLT_SERVER_MODE).toBe("1");
    expect(context.env.BEADS_DOLT_SERVER_HOST).toBe("127.0.0.1");
    expect(context.env.BEADS_DOLT_SERVER_PORT).toBe("36123");
    expect(context.env.BEADS_DOLT_SERVER_USER).toBe("root");
    expect(context.serverStatePath).toBe(path.join(serverRoot, "server.json"));
  });

  test("serializes concurrent shared Dolt startup for the same config root", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-config-shared-flight-test-"));
    const processEnv = { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot };
    const sharedServerRoot = path.join(configRoot, "beads", "shared-server");
    const paths: BeadsSharedServerPaths = {
      baseDir: configRoot,
      beadsRoot: path.join(configRoot, "beads"),
      sharedServerRoot,
      doltRoot: path.join(sharedServerRoot, "dolt"),
      cfgDir: path.join(sharedServerRoot, ".doltcfg"),
      doltConfigFile: path.join(sharedServerRoot, "dolt-config.yaml"),
      env: processEnv,
      serverStatePath: path.join(sharedServerRoot, "server.json"),
    };
    const calls: string[] = [];
    let markStartupStarted: () => void = () => {};
    const startupStarted = new Promise<void>((resolve) => {
      markStartupStarted = resolve;
    });
    let releaseStartup: () => void = () => {};
    const startupGate = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
    const ensureSharedServer: EnsureSharedDoltServer = async (paths) => {
      calls.push(paths.sharedServerRoot);
      markStartupStarted();
      await startupGate;
      return {
        pid: process.pid,
        ownerPid: process.pid,
        acquisition: "started_by_owner" as const,
        host: "127.0.0.1",
        user: "root",
        port: 36004,
        sharedServerRoot: paths.sharedServerRoot,
        doltDataDir: paths.doltRoot,
        startedAt: "2026-05-10T00:00:00Z",
      };
    };

    const firstContextPromise = ensureSharedDoltServerRunning(paths, ensureSharedServer);
    await startupStarted;
    const secondContextPromise = ensureSharedDoltServerRunning(paths, ensureSharedServer);

    await Promise.resolve();
    expect(calls).toEqual([sharedServerRoot]);
    releaseStartup();

    const [firstState, secondState] = await Promise.all([
      firstContextPromise,
      secondContextPromise,
    ]);

    expect(calls).toEqual([sharedServerRoot]);
    expect(firstState.port).toBe(36004);
    expect(secondState.port).toBe(36004);
  });
});

describe("createBeadsAttachmentProvisioner", () => {
  const createContext = async (): Promise<BeadsCliContext> => {
    const attachmentRoot = await mkdtemp(path.join(tmpdir(), "odt-beads-attachment-test-"));
    const beadsDir = path.join(attachmentRoot, ".beads");
    return {
      repoPath: "/repo/My Repo",
      repoId: "my-repo-12345678",
      databaseName: "odt_my_repo_123456789abc",
      attachmentRoot,
      beadsDir,
      workingDir: attachmentRoot,
      serverStatePath: "/config/beads/shared-server/server.json",
      sharedServer: {
        pid: process.pid,
        ownerPid: process.pid,
        acquisition: "started_by_owner",
        host: "127.0.0.1",
        user: "root",
        port: 36003,
        sharedServerRoot: "/config/beads/shared-server",
        doltDataDir: "/config/beads/shared-server/dolt",
        startedAt: "2026-05-10T00:00:00Z",
      },
      env: {
        BEADS_DIR: beadsDir,
        BEADS_DOLT_SERVER_MODE: "1",
        BEADS_DOLT_SERVER_HOST: "127.0.0.1",
        BEADS_DOLT_SERVER_PORT: "36003",
        BEADS_DOLT_SERVER_USER: "root",
      },
    };
  };

  const writeMetadata = async (context: BeadsCliContext): Promise<void> => {
    await writeFile(
      path.join(context.beadsDir, "metadata.json"),
      JSON.stringify({
        backend: "dolt",
        dolt_mode: "server",
        dolt_server_host: "127.0.0.1",
        dolt_server_port: 36003,
        dolt_server_user: "root",
        dolt_database: context.databaseName,
      }),
    );
  };

  test("initializes missing attachments and configures workflow statuses", async () => {
    const context = await createContext();
    const calls: Array<{ command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> =
      [];

    const provision = createBeadsAttachmentProvisioner(async (input) => {
      calls.push(input);
      if (input.args[0] === "init") {
        await mkdir(context.beadsDir, { recursive: true });
        await writeMetadata(context);
        await writeFile(
          path.join(context.beadsDir, "config.yaml"),
          "json: true\nno-git-ops: false # keep\n",
        );
      }
      if (input.command === "dolt" && input.args.at(-1) === "show databases") {
        return { ok: true, stdout: `| ${context.databaseName} |\n`, stderr: "" };
      }
      if (input.args[0] === "where") {
        return { ok: true, stdout: JSON.stringify({ path: context.beadsDir }), stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    await provision(context);

    expect(calls).toEqual([
      {
        command: "bd",
        cwd: context.attachmentRoot,
        env: context.env,
        args: [
          "init",
          "--server",
          "--server-host",
          "127.0.0.1",
          "--server-port",
          "36003",
          "--server-user",
          "root",
          "--quiet",
          "--stealth",
          "--skip-hooks",
          "--skip-agents",
          "--prefix",
          "my-repo",
          "--database",
          "odt_my_repo_123456789abc",
        ],
      },
      {
        command: "dolt",
        env: context.env,
        args: [
          "--host",
          "127.0.0.1",
          "--port",
          "36003",
          "--no-tls",
          "-u",
          "root",
          "-p",
          "",
          "sql",
          "-q",
          "show databases",
        ],
      },
      {
        command: "bd",
        cwd: context.attachmentRoot,
        env: context.env,
        args: ["where", "--json"],
      },
      {
        command: "bd",
        cwd: context.attachmentRoot,
        env: context.env,
        args: ["config", "set", "status.custom", "spec_ready,ready_for_dev,ai_review,human_review"],
      },
    ]);
    await expect(readFile(path.join(context.beadsDir, "config.yaml"), "utf8")).resolves.toBe(
      "json: true\nno-git-ops: true # keep\n",
    );
  });

  test("initializes missing path-edge attachments from the attachment root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "odt provisioning C:\\Users\\Max Sky-"));
    const attachmentRoot = path.join(parent, "Attachment Root With Spaces");
    const beadsDir = path.join(attachmentRoot, ".beads");
    const context: BeadsCliContext = {
      ...(await createContext()),
      attachmentRoot,
      beadsDir,
      workingDir: attachmentRoot,
      env: {
        BEADS_DIR: beadsDir,
        BEADS_DOLT_SERVER_MODE: "1",
        BEADS_DOLT_SERVER_HOST: "127.0.0.1",
        BEADS_DOLT_SERVER_PORT: "36003",
        BEADS_DOLT_SERVER_USER: "root",
      },
    };
    const calls: Array<{ command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> =
      [];

    await initializeMissingAttachment(async (input) => {
      calls.push(input);
      return { ok: true, stdout: "", stderr: "" };
    }, context);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("bd");
    expect(calls[0]?.cwd).toBe(context.attachmentRoot);
    expect(calls[0]?.env).toBe(context.env);
    expect(calls[0]?.args).toContain("--database");
    expect(calls[0]?.args).toContain(context.databaseName);
  });

  test("restores a missing shared database from the attachment backup", async () => {
    const context = await createContext();
    await mkdir(path.join(context.beadsDir, "backup"), { recursive: true });
    await writeMetadata(context);
    let restored = false;
    const calls: Array<{ command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> =
      [];
    const provision = createBeadsAttachmentProvisioner(async (input) => {
      calls.push(input);
      if (input.command === "dolt" && input.args.at(-1) === "show databases") {
        return {
          ok: true,
          stdout: restored ? `| ${context.databaseName} |\n` : "| other_database |\n",
          stderr: "",
        };
      }
      if (input.command === "dolt" && input.args[0] === "backup") {
        restored = true;
        return { ok: true, stdout: "restored backup", stderr: "" };
      }
      if (input.args[0] === "where") {
        return { ok: true, stdout: JSON.stringify({ path: context.beadsDir }), stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    await provision(context);

    expect(calls).toContainEqual({
      command: "dolt",
      cwd: context.sharedServer?.doltDataDir ?? "",
      env: context.env,
      args: [
        "backup",
        "restore",
        `file://${path.join(context.beadsDir, "backup")}`,
        context.databaseName,
      ],
    });
    expect(restored).toBe(true);
  });

  test("repairs attachment verification failures with bd doctor", async () => {
    const context = await createContext();
    await mkdir(context.beadsDir, { recursive: true });
    await writeMetadata(context);
    let repaired = false;
    const calls: Array<{ command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> =
      [];
    const provision = createBeadsAttachmentProvisioner(async (input) => {
      calls.push(input);
      if (input.command === "dolt" && input.args.at(-1) === "show databases") {
        return { ok: true, stdout: `| ${context.databaseName} |\n`, stderr: "" };
      }
      if (input.args[0] === "doctor") {
        repaired = true;
        return { ok: true, stdout: "fixed", stderr: "" };
      }
      if (input.args[0] === "where") {
        return {
          ok: true,
          stdout: JSON.stringify(
            repaired ? { path: context.beadsDir } : { error: "attachment mismatch" },
          ),
          stderr: "",
        };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    await provision(context);

    expect(calls).toContainEqual({
      command: "bd",
      cwd: context.attachmentRoot,
      env: context.env,
      args: ["doctor", "--fix", "--yes"],
    });
  });

  test("rejects invalid attachment contracts without repair", async () => {
    const context = await createContext();
    await mkdir(context.beadsDir, { recursive: true });
    await writeFile(
      path.join(context.beadsDir, "metadata.json"),
      JSON.stringify({
        backend: "dolt",
        dolt_mode: "server",
        dolt_server_host: "127.0.0.1",
        dolt_server_port: 36003,
        dolt_server_user: "root",
        dolt_database: "wrong_database",
      }),
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    const provision = createBeadsAttachmentProvisioner(async (input) => {
      calls.push(input);
      return { ok: true, stdout: "", stderr: "" };
    });

    await expect(provision(context)).rejects.toThrow(
      `Beads attachment database is "wrong_database", expected ${context.databaseName}`,
    );
    expect(calls).toEqual([]);
  });
});
