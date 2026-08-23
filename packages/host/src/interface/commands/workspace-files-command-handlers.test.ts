import { describe, expect, test } from "bun:test";
import type { WorkspaceTextFileWriteInput } from "@openducktor/contracts";
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
          revision: "revision-1",
        });
      },
      writeTextFile: () => Effect.die("not used"),
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
          revision: "revision-1",
        });
      },
      writeTextFile: () => Effect.die("not used"),
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

  test("routes a strict text file write input and returns the authoritative result", async () => {
    const received: WorkspaceTextFileWriteInput[] = [];
    const service: WorkspaceFilesService = {
      listTree: () => Effect.die("not used"),
      readTextFile: () => Effect.die("not used"),
      writeTextFile: (input) => {
        received.push(input);
        return Effect.succeed({
          kind: "text",
          rootPath: input.rootPath,
          relativePath: input.relativePath,
          contents: input.contents,
          size: input.contents.length,
          mtimeMs: 2,
          revision: "revision-2",
        });
      },
    };
    const router = createEffectHostCommandRouter({
      handlers: createWorkspaceFilesCommandHandlers(service),
    });

    const result = await Effect.runPromise(
      router.invoke("filesystem_write_text_file", {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
        revision: "revision-1",
      }),
    );

    expect(received).toEqual([
      {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
        revision: "revision-1",
      },
    ]);
    expect(result).toMatchObject({ contents: "saved", revision: "revision-2" });
  });

  test("rejects invalid write input before calling the service", async () => {
    const received: WorkspaceTextFileWriteInput[] = [];
    const service: WorkspaceFilesService = {
      listTree: () => Effect.die("not used"),
      readTextFile: () => Effect.die("not used"),
      writeTextFile: (input) => {
        received.push(input);
        return Effect.die("invalid input reached the service");
      },
    };
    const router = createEffectHostCommandRouter({
      handlers: createWorkspaceFilesCommandHandlers(service),
    });

    const exit = await Effect.runPromiseExit(
      router.invoke("filesystem_write_text_file", {
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(received).toEqual([]);
    expect(String(exit)).toContain("HostValidationError");
    expect(String(exit)).toContain("filesystem_write_text_file input is invalid");
  });
});
