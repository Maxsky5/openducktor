import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "./settings-config-adapter";

const withDirectory = async (run: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "odt-lifecycle-path-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("workspace lifecycle path resolution", () => {
  test.each(["relative target", "symlinked parent"])(
    "recovers the canonical path through a %s after target ancestors are deleted",
    async (linkKind) => {
      await withDirectory(async (root) => {
        const parent = join(root, "repositories");
        const repository = join(parent, "repo");
        await mkdir(repository, { recursive: true });
        const expected = await realpath(repository);
        const alias = join(root, "alias");
        if (linkKind === "relative target") {
          await symlink(join("repositories", "repo"), alias, "dir");
        } else {
          await symlink(parent, alias, "junction");
        }
        await rm(parent, { recursive: true });

        const resolved = await Effect.runPromise(
          createSettingsConfigAdapter().resolveWorkspaceLifecyclePath(
            linkKind === "relative target" ? alias : join(alias, "repo"),
          ),
        );

        expect(resolved).toBe(expected);
      });
    },
  );

  test.each(["direct", "missing segment"])(
    "rejects a %s symlink loop with an actionable typed error",
    async (loopKind) => {
      await withDirectory(async (root) => {
        const first = join(root, "first");
        const second = join(root, "second");
        if (loopKind === "direct") {
          await symlink(second, first, "dir");
          await symlink(first, second, "dir");
        } else {
          await symlink("missing/../first", first, "dir");
        }

        const result = await Effect.runPromise(
          Effect.either(createSettingsConfigAdapter().resolveWorkspaceLifecyclePath(first)),
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("HostOperationError");
          expect(result.left.message).toContain("fix the symlink and retry");
        }
      });
    },
  );

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "rejects an inaccessible path instead of treating it as deleted",
    async () => {
      await withDirectory(async (root) => {
        const locked = join(root, "locked");
        await mkdir(locked);
        await chmod(locked, 0);
        try {
          const result = await Effect.runPromise(
            Effect.either(
              createSettingsConfigAdapter().resolveWorkspaceLifecyclePath(join(locked, "repo")),
            ),
          );

          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.cause).toMatchObject({ code: "EACCES" });
            expect(result.left.message).toContain("Restore path access");
          }
        } finally {
          await chmod(locked, 0o700);
        }
      });
    },
  );
});
