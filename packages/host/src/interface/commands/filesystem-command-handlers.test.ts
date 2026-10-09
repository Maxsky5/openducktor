import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createFilesystemService } from "../../application/filesystem/filesystem-service";
import { HostOperationError } from "../../effect/host-errors";
import { Effect } from "effect";
import type { FilesystemService } from "../../application/filesystem/filesystem-service";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createFilesystemCommandHandlers } from "./filesystem-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createFilesystemCommandHandlers", () => {
  test("resolves an owner alias and returns null after its directory is removed", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "openducktor-owner-path-"));
    const directory = path.join(folder, "worktree");
    const alias = path.join(folder, "alias");
    const router = createHostCommandRouter({
      handlers: createFilesystemCommandHandlers(createFilesystemService(createFilesystemAdapter())),
    });
    try {
      await mkdir(directory);
      await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
      await expect(router.invoke("filesystem_resolve_path", { path: alias })).resolves.toBe(
        await realpath(directory),
      );
      await rm(directory, { recursive: true });
      await expect(router.invoke("filesystem_resolve_path", { path: alias })).resolves.toBeNull();
      await expect(router.invoke("filesystem_resolve_path", { path: 123 })).rejects.toThrow(
        "filesystem_resolve_path input is invalid",
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  for (const code of ["EACCES", "EIO"]) {
    test(`owner path resolution reports ${code}`, async () => {
      const filesystem = createFilesystemAdapter();
      filesystem.canonicalize = (path) =>
        Effect.fail(
          new HostOperationError({
            operation: "filesystem.canonicalize",
            message: `Cannot resolve ${path}: ${code}`,
            cause: Object.assign(new Error(code), { code }),
          }),
        );
      const router = createHostCommandRouter({
        handlers: createFilesystemCommandHandlers(createFilesystemService(filesystem)),
      });
      await expect(router.invoke("filesystem_resolve_path", { path: "/repo" })).rejects.toThrow(
        `Cannot resolve /repo: ${code}`,
      );
    });
  }
  test("routes filesystem_list_directory through the filesystem service", async () => {
    const calls: unknown[] = [];
    const filesystemService: FilesystemService = {
      resolvePath: () => Effect.die("unused"),
      listDirectory(input) {
        return Effect.sync(() => {
          calls.push(input);
          return {
            currentPath: "/repo",
            currentPathIsGitRepo: true,
            parentPath: "/",
            homePath: "/home/dev",
            entries: [],
          };
        });
      },
    };
    const router = createHostCommandRouter({
      handlers: createFilesystemCommandHandlers(filesystemService),
    });
    await expect(router.invoke("filesystem_list_directory", { path: "/repo" })).resolves.toEqual({
      currentPath: "/repo",
      currentPathIsGitRepo: true,
      parentPath: "/",
      homePath: "/home/dev",
      entries: [],
    });
    expect(calls).toEqual([{ path: "/repo" }]);
  });
  test("rejects malformed filesystem_list_directory args", async () => {
    const filesystemService: FilesystemService = {
      resolvePath: () => Effect.die("unused"),
      listDirectory() {
        return Effect.die(new Error("should not call filesystem service"));
      },
    };
    const router = createHostCommandRouter({
      handlers: createFilesystemCommandHandlers(filesystemService),
    });
    await expect(router.invoke("filesystem_list_directory", { path: 123 })).rejects.toThrow(
      "filesystem_list_directory received invalid arguments.",
    );
  });
});
