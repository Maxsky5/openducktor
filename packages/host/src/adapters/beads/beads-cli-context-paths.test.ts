import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { databaseNameForWorkspace } from "../../infrastructure/beads/beads-context-model";
import { resolveBeadsCliContext } from "./beads-cli-context";

const TEST_BEADS_TOOL_PATHS = {
  beads: "bd",
};

describe("resolveBeadsCliContext path identity", () => {
  test("resolves workspace-scoped managed Beads paths when workspace id is provided", async () => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-config-workspace-test-"));
    const repoRoot = await mkdtemp(path.join(tmpdir(), "My Repo-"));
    const canonicalRepoRoot = await realpath(repoRoot);

    const context = await Effect.runPromise(
      resolveBeadsCliContext(repoRoot, {
        processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot },
        requireSharedServer: false,
        tools: TEST_BEADS_TOOL_PATHS,
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
        "C-Users\\Max Sky\\Repo Name",
      ),
      path.join(await mkdtemp(path.join(tmpdir(), "repo-case-")), "Repo Name"),
    ];

    const contexts = await Promise.all(
      repoPaths.map((repoPath) =>
        Effect.runPromise(
          resolveBeadsCliContext(repoPath, {
            processEnv,
            requireSharedServer: false,
            tools: TEST_BEADS_TOOL_PATHS,
            workspaceId,
          }),
        ),
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

    const existingContext = await Effect.runPromise(
      resolveBeadsCliContext(existingRepo, {
        processEnv,
        requireSharedServer: false,
        tools: TEST_BEADS_TOOL_PATHS,
      }),
    );

    expect(existingContext.repoPath).toBe(canonicalExistingRepo);
    expect(existingContext.repoId).toMatch(/^repo-with-spaces-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(existingContext.databaseName).toMatch(/^odt_repo_with_spaces_[a-z0-9]+_[a-f0-9]{12}$/);

    const syntheticRepo = path.join(configRoot, "missing repos", "C-Users-Max Sky-Repo Name");
    const syntheticContext = await Effect.runPromise(
      resolveBeadsCliContext(syntheticRepo, {
        processEnv,
        requireSharedServer: false,
        tools: TEST_BEADS_TOOL_PATHS,
      }),
    );

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
      Effect.runPromise(
        resolveBeadsCliContext(lowerRepo, {
          processEnv,
          requireSharedServer: false,
          tools: TEST_BEADS_TOOL_PATHS,
        }),
      ),
      Effect.runPromise(
        resolveBeadsCliContext(upperRepo, {
          processEnv,
          requireSharedServer: false,
          tools: TEST_BEADS_TOOL_PATHS,
        }),
      ),
    ]);

    expect(lowerContext.repoPath).toBe(lowerRepo);
    expect(upperContext.repoPath).toBe(upperRepo);
    expect(lowerContext.repoId).not.toBe(upperContext.repoId);
    expect(lowerContext.databaseName).not.toBe(upperContext.databaseName);
  });

  test("keeps managed paths under config roots with path-edge names", async () => {
    const configRoot = await mkdtemp(
      path.join(tmpdir(), "odt config C-Users-Max Sky-OpenDucktor-"),
    );
    const repoRoot = await mkdtemp(path.join(tmpdir(), "Repo With Spaces-"));

    const context = await Effect.runPromise(
      resolveBeadsCliContext(repoRoot, {
        processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: configRoot },
        requireSharedServer: false,
        tools: TEST_BEADS_TOOL_PATHS,
        workspaceId: "workspace-id",
      }),
    );

    expect(context.attachmentRoot).toBe(path.join(configRoot, "beads", "workspace-id"));
    expect(context.beadsDir).toBe(path.join(configRoot, "beads", "workspace-id", ".beads"));
    expect(context.serverStatePath).toBe(
      path.join(configRoot, "beads", "shared-server", "server.json"),
    );
  });

  test("rejects an empty configured OpenDucktor config dir", async () => {
    await expect(
      Effect.runPromise(
        resolveBeadsCliContext("/repo", {
          processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: "" },
          requireSharedServer: false,
          tools: TEST_BEADS_TOOL_PATHS,
        }),
      ),
    ).rejects.toThrow("OPENDUCKTOR_CONFIG_DIR is set but empty");
  });
});
