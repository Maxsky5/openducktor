import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktreeFileAdapter } from "./worktree-file-adapter";

const createTempRoot = (): Promise<string> => mkdtemp(path.join(tmpdir(), "odt-worktree-file-"));

describe("createWorktreeFileAdapter", () => {
  test("copies configured repository paths into a worktree", async () => {
    const root = await createTempRoot();
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "worktree");
    await mkdir(path.join(repo, "config"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(repo, ".env"), "TOKEN=dev\n");
    await writeFile(path.join(repo, "config", "local.json"), "{}\n");
    const files = createWorktreeFileAdapter();

    try {
      await files.copyConfiguredPaths(repo, worktree, [".env", "config/local.json"]);

      await expect(readFile(path.join(worktree, ".env"), "utf8")).resolves.toBe("TOKEN=dev\n");
      await expect(readFile(path.join(worktree, "config", "local.json"), "utf8")).resolves.toBe(
        "{}\n",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects configured copy paths that leave the repository", async () => {
    const root = await createTempRoot();
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "worktree");
    await mkdir(repo, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "# repo\n");
    await writeFile(path.join(worktree, ".keep"), "");
    const files = createWorktreeFileAdapter();

    try {
      await expect(files.copyConfiguredPaths(repo, worktree, ["../secret"])).rejects.toThrow(
        "cannot traverse outside",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
