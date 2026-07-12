import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { createEffectHostCommandRouter } from "../router/host-command-router";
import { createWorkspaceFilesCommandHandlers } from "./workspace-files-command-handlers";

describe("createWorkspaceFilesCommandHandlers", () => {
  test("preserves significant whitespace in workspace root paths", async () => {
    const receivedRootPaths: string[] = [];
    const service: WorkspaceFilesService = {
      listTree: (input) => {
        receivedRootPaths.push(input.rootPath);
        return Effect.succeed({ rootPath: input.rootPath, entries: [] });
      },
      readTextFile: (input) => {
        receivedRootPaths.push(input.rootPath);
        return Effect.succeed({
          kind: "text",
          rootPath: input.rootPath,
          relativePath: input.relativePath,
          contents: "ok",
          size: 2,
          mtimeMs: null,
        });
      },
    };
    const router = createEffectHostCommandRouter({
      handlers: createWorkspaceFilesCommandHandlers(service),
    });

    await Effect.runPromise(router.invoke("filesystem_list_tree", { rootPath: " /repo " }));
    await Effect.runPromise(
      router.invoke("filesystem_read_text_file", {
        rootPath: " /repo ",
        relativePath: "README.md",
      }),
    );

    expect(receivedRootPaths).toEqual([" /repo ", " /repo "]);
  });

  test("preserves significant whitespace in relative file paths", async () => {
    const receivedRelativePaths: string[] = [];
    const service: WorkspaceFilesService = {
      listTree: () => Effect.die("not used"),
      readTextFile: (input) => {
        receivedRelativePaths.push(input.relativePath);
        return Effect.succeed({
          kind: "text",
          rootPath: input.rootPath,
          relativePath: input.relativePath,
          contents: "ok",
          size: 2,
          mtimeMs: null,
        });
      },
    };
    const router = createEffectHostCommandRouter({
      handlers: createWorkspaceFilesCommandHandlers(service),
    });

    await Effect.runPromise(
      router.invoke("filesystem_read_text_file", {
        rootPath: "/repo",
        relativePath: " padded.ts ",
      }),
    );

    expect(receivedRelativePaths).toEqual([" padded.ts "]);
  });
});
