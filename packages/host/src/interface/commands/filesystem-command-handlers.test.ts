import type { FilesystemService } from "../../application/filesystem/filesystem-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createFilesystemCommandHandlers } from "./filesystem-command-handlers";

describe("createFilesystemCommandHandlers", () => {
  test("routes filesystem_list_directory through the filesystem service", async () => {
    const calls: unknown[] = [];
    const filesystemService: FilesystemService = {
      async listDirectory(input) {
        calls.push(input);
        return {
          currentPath: "/repo",
          currentPathIsGitRepo: true,
          parentPath: "/",
          homePath: "/home/dev",
          entries: [],
        };
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
      async listDirectory() {
        throw new Error("should not call filesystem service");
      },
    };
    const router = createHostCommandRouter({
      handlers: createFilesystemCommandHandlers(filesystemService),
    });

    await expect(router.invoke("filesystem_list_directory", { path: 123 })).rejects.toThrow(
      "filesystem_list_directory expects optional string argument 'path'.",
    );
  });
});
