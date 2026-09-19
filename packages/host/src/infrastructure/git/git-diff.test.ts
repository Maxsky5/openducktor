import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileStatus } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import fixtures from "./fixtures/no-index-diffs.json";
import { type GitCommandRunner } from "./git-command-runner";
import { buildFileDiffs } from "./git-diff";

const status = (file: string): FileStatus => ({ path: file, status: "untracked", staged: false });
const withFiles = async (files: string[], run: (root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-untracked-"));
  try {
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), "hello\n");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("untracked file diffs", () => {
  for (const fixture of fixtures) {
    test(`parses the Git fixture for ${JSON.stringify(fixture.file)}`, async () => {
      // The runner owns filename transport, so these fixtures also run on Windows.
      const runner: GitCommandRunner = () =>
        Effect.succeed({
          ok: false,
          exitCode: 1,
          stdout: fixture.combined,
          stderr: "",
        });
      await withFiles(["placeholder"], async (root) => {
        await expect(
          Effect.runPromise(buildFileDiffs(runner, root, [status(fixture.file)], "", "")),
        ).resolves.toEqual([
          {
            file: fixture.file,
            type: "added",
            additions: fixture.additions,
            deletions: 0,
            diff: fixture.patch.replace(/\r?\n/g, "\n") + "\n",
          },
        ]);
      });
    });
  }

  for (const count of [0, 1, 100]) {
    test(`uses ${count} commands with bounded concurrency and stable results`, async () => {
      const files = Array.from({ length: count }, (_, index) => `file-${index}.txt`);
      await withFiles(files, async (root) => {
        let calls = 0;
        let active = 0;
        let peak = 0;
        const program = Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const runner: GitCommandRunner = (_root, args) =>
            Effect.gen(function* () {
              expect(args.slice(0, 6)).toEqual([
                "diff",
                "--no-index",
                "--numstat",
                "-z",
                "--patch",
                "--",
              ]);
              const file = args.at(-1)!;
              calls += 1;
              active += 1;
              peak = Math.max(peak, active);
              if (active === Math.min(count, 4)) yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              active -= 1;
              return {
                ok: false,
                exitCode: 1,
                stdout: `1\t0\t\0/dev/null\0${file}\0\0diff --git a/${file} b/${file}\nnew file mode 100644\n`,
                stderr: "",
              };
            });
          const fiber = yield* Effect.fork(
            buildFileDiffs(
              runner,
              root,
              files.flatMap((file) => [status(file), status(file)]),
              "",
              "",
            ),
          );
          if (count > 0) yield* Deferred.await(started);
          yield* Deferred.succeed(release, undefined);
          return yield* Fiber.join(fiber);
        });
        const result = await Effect.runPromise(program);
        expect(calls).toBe(count);
        expect(peak).toBe(Math.min(count, 4));
        expect(result).toEqual(
          files
            .sort((a, b) => a.localeCompare(b))
            .map((file) => ({
              file,
              type: "added",
              additions: 1,
              deletions: 0,
              diff: `diff --git a/${file} b/${file}\nnew file mode 100644\n\n`,
            })),
        );
      });
    });
  }

  test("rejects a failed command even when stdout contains a valid diff", async () => {
    const fixture = fixtures[0]!;
    const runner: GitCommandRunner = () =>
      Effect.succeed({ ok: false, exitCode: 2, stdout: fixture.combined, stderr: "read failed" });
    await withFiles([fixture.file], async (root) => {
      await expect(
        Effect.runPromise(buildFileDiffs(runner, root, [status(fixture.file)], "", "")),
      ).rejects.toThrow("read failed");
    });
  });
});

test("expands each directory once and deduplicates paths before loading diffs", async () => {
  await withFiles(["generated/file.txt"], async (root) => {
    const file = "generated/ spaced\t\nfile.txt ";
    const calls: string[][] = [];
    const runner: GitCommandRunner = (_root, args) => {
      calls.push(args);
      if (args[0] === "ls-files")
        return Effect.succeed({ ok: true, stdout: `${file}\0${file}\0tracked.txt\0`, stderr: "" });
      return Effect.succeed({
        ok: false,
        exitCode: 1,
        stdout: `1\t0\t\0/dev/null\0${file}\0\0diff --git a/file b/file\nnew file mode 100644\n`,
        stderr: "",
      });
    };
    const result = await Effect.runPromise(
      buildFileDiffs(
        runner,
        root,
        [status("generated/"), status("generated/"), status(file)],
        "2\t1\ttracked.txt\n",
        "diff --git a/tracked.txt b/tracked.txt\n",
      ),
    );
    expect(calls).toEqual([
      ["ls-files", "--others", "--exclude-standard", "-z", "--", "generated/"],
      ["diff", "--no-index", "--numstat", "-z", "--patch", "--", "/dev/null", file],
    ]);
    expect(result).toEqual([
      {
        file,
        type: "added",
        additions: 1,
        deletions: 0,
        diff: "diff --git a/file b/file\nnew file mode 100644\n\n",
      },
      {
        file: "tracked.txt",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "diff --git a/tracked.txt b/tracked.txt\n\n",
      },
    ]);
  });
});

for (const [stdout, ok, message] of [
  ["", true, "returned no files"],
  ["partial\0", false, "cannot list directory"],
] as const) {
  test(`reports directory expansion failure: ${message}`, async () => {
    await withFiles(["dir/file"], async (root) => {
      const runner: GitCommandRunner = () =>
        Effect.succeed({ ok, stdout, stderr: ok ? "" : message });
      await expect(
        Effect.runPromise(buildFileDiffs(runner, root, [status("dir/")], "", "")),
      ).rejects.toThrow(message);
    });
  });
}

for (const exitCode of [0, 1]) {
  test(`accepts valid combined output at exit ${exitCode}`, async () => {
    const fixture = fixtures[0]!;
    const runner: GitCommandRunner = () =>
      Effect.succeed({ ok: exitCode === 0, exitCode, stdout: fixture.combined, stderr: "" });
    await withFiles([fixture.file], async (root) => {
      const result = await Effect.runPromise(
        buildFileDiffs(runner, root, [status(fixture.file)], "", ""),
      );
      expect(result[0]?.additions).toBe(1);
    });
  });
}

for (const stdout of [
  "",
  "not numstat",
  fixtures[0]!.combined.replace("plain.txt\0", "other.txt\0"),
  "1\t0\t\0/dev/null\0plain.txt\0",
  "1\t0\t\0/dev/null\0plain.txt\0\0not a patch",
]) {
  test(`rejects missing or malformed combined output ${JSON.stringify(stdout.slice(0, 30))}`, async () => {
    const runner: GitCommandRunner = () =>
      Effect.succeed({ ok: false, exitCode: 1, stdout, stderr: "cannot read file" });
    await withFiles(["plain.txt"], async (root) => {
      await expect(
        Effect.runPromise(buildFileDiffs(runner, root, [status("plain.txt")], "", "")),
      ).rejects.toThrow("no matching diff entry for plain.txt");
    });
  });
}

test("stops queued work and finalizes active workers after a command failure", async () => {
  await withFiles(
    Array.from({ length: 8 }, (_, i) => `${i}.txt`),
    async (root) => {
      let calls = 0;
      let active = 0;
      const program = Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const runner: GitCommandRunner = (_root, args) =>
          Effect.gen(function* () {
            calls += 1;
            active += 1;
            if (calls === 4) yield* Deferred.succeed(started, undefined);
            if (args.at(-1) === "0.txt") {
              yield* Deferred.await(started);
              return { ok: false, exitCode: 2, stdout: "partial", stderr: "disk read failed" };
            }
            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active -= 1;
              }),
            ),
          );
        return yield* buildFileDiffs(
          runner,
          root,
          Array.from({ length: 8 }, (_, i) => status(`${i}.txt`)),
          "",
          "",
        );
      });
      await expect(Effect.runPromise(program)).rejects.toThrow("disk read failed");
      expect(calls).toBe(4);
      expect(active).toBe(0);
    },
  );
});

test("matches the recorded patches with real Git, including directory expansion", async () => {
  const supported = fixtures.filter(
    // oxlint-disable-next-line no-control-regex -- Windows forbids control characters in filenames.
    (fixture) => process.platform !== "win32" || !/[<>:"\\|?*\x00-\x1f]|[ .]$/.test(fixture.file),
  );
  await withFiles(
    supported.map((fixture) => fixture.file),
    async (root) => {
      const { createDefaultGitRunner } = await import("./git-command-runner");
      const runner = createDefaultGitRunner(process.env, { command: "git" });
      await Effect.runPromise(runner(root, ["init", "--quiet"]));
      await Effect.runPromise(runner(root, ["config", "core.autocrlf", "false"]));
      for (const fixture of supported)
        await writeFile(path.join(root, fixture.file), fixture.content);
      const result = await Effect.runPromise(buildFileDiffs(runner, root, [status(".")], "", ""));
      expect(result).toEqual(
        supported
          .map((fixture) => ({
            file: fixture.file,
            type: "added",
            additions: fixture.additions,
            deletions: 0,
            diff: fixture.patch.replace(/\r?\n/g, "\n") + "\n",
          }))
          .sort((a, b) => a.file.localeCompare(b.file)),
      );
      await expect(
        Effect.runPromise(buildFileDiffs(runner, root, [status("missing.txt")], "", "")),
      ).rejects.toThrow("missing.txt");
    },
  );
});
