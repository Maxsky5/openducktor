import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { GitCommandRunner } from "./git-command-runner";
import { createGitMergeDetectionMethods } from "./git-merge-detection";

const recordingRunner = (result: { ok: boolean; stdout: string; stderr?: string }) => {
  const calls: { args: string[]; stdin: string | undefined }[] = [];
  const runner: GitCommandRunner = (_cwd, args, options) =>
    Effect.sync(() => {
      calls.push({ args, stdin: options?.stdin });
      return { stderr: "", exitCode: result.ok ? 0 : 128, ...result };
    });
  return { calls, methods: createGitMergeDetectionMethods(runner) };
};

describe("ahead count", () => {
  test("counts the commits that the base lacks for each ref of the patterns, in one call", async () => {
    const { calls, methods } = recordingRunner({
      ok: true,
      stdout: "refs/heads/odt/task-1\u00000 4\nrefs/heads/odt/task-2\u00003 1\n",
    });

    const counts = await Effect.runPromise(
      methods.countCommitsAhead("/repo", "abc123", ["refs/heads/odt/"]),
    );

    expect([...counts]).toEqual([
      ["refs/heads/odt/task-1", 0],
      ["refs/heads/odt/task-2", 3],
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      ["for-each-ref", "--format=%(refname)%00%(ahead-behind:abc123)", "refs/heads/odt/"],
    ]);
    expect([
      ...(await Effect.runPromise(methods.countCommitsAhead("/repo", "abc123", []))),
    ]).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("names the Git version that an old Git lacks", async () => {
    const { methods } = recordingRunner({
      ok: false,
      stdout: "",
      stderr: "fatal: unknown field name: ahead-behind:abc123",
    });

    await expect(
      Effect.runPromise(methods.countCommitsAhead("/repo", "abc123", ["refs/heads/odt/task-1"])),
    ).rejects.toThrow("Merge detection needs Git 2.41 or later.");
  });
});

describe("merge trees", () => {
  test("writes the tree of each merge in one call, null for a merge with conflicts", async () => {
    const { calls, methods } = recordingRunner({
      ok: true,
      stdout: "1\u0000tree-1\u0000\u00000\u0000tree-2\u0000a.txt\u0000b.txt\u0000\u0000",
    });

    const trees = await Effect.runPromise(
      methods.mergeTreeOids("/repo", [
        { first: "main", second: "task-1" },
        { first: "main", second: "task-2" },
      ]),
    );

    expect(trees).toEqual(["tree-1", null]);
    expect(calls).toEqual([
      {
        args: ["merge-tree", "--write-tree", "--stdin", "--name-only", "--no-messages"],
        stdin: "main task-1\nmain task-2\n",
      },
    ]);
  });

  test("fails when Git gives no record for each merge", async () => {
    // A commit that Git cannot read stops the merges, and Git exits with 1.
    const { methods } = recordingRunner({
      ok: false,
      stdout: "1\u0000tree-1\u0000\u0000",
      stderr: "merge-tree: deadbeef - not something we can merge",
    });

    await expect(
      Effect.runPromise(
        methods.mergeTreeOids("/repo", [
          { first: "main", second: "task-1" },
          { first: "main", second: "deadbeef" },
        ]),
      ),
    ).rejects.toThrow("not something we can merge");
  });
});

describe("reflog read", () => {
  test("reads the reflogs of all refs in one call, newest first for each ref", async () => {
    // The walk mixes the entries of the refs by time. A ref without a reflog adds no line.
    const { calls, methods } = recordingRunner({
      ok: true,
      stdout: [
        "refs/heads/odt/task-2@{0}\u0000bbb2\u0000commit: Fix login",
        "refs/heads/odt/task-1@{0}\u0000aaa1\u0000commit: Add login",
        "refs/heads/odt/task-2@{1}\u0000bbb1\u0000branch: Created from main",
        "refs/heads/odt/task-1@{1}\u0000aaa0\u0000branch: Created from main",
        "",
      ].join("\n"),
    });
    const refs = ["refs/heads/odt/task-1", "refs/heads/odt/task-2", "refs/heads/odt/task-3"];

    const reflogs = await Effect.runPromise(methods.readReflogs("/repo", refs));

    expect(Object.fromEntries(reflogs)).toEqual({
      "refs/heads/odt/task-1": [
        { oid: "aaa1", subject: "commit: Add login" },
        { oid: "aaa0", subject: "branch: Created from main" },
      ],
      "refs/heads/odt/task-2": [
        { oid: "bbb2", subject: "commit: Fix login" },
        { oid: "bbb1", subject: "branch: Created from main" },
      ],
    });
    // The refs go on stdin, so many tasks do not make a command line that is too long.
    expect(calls).toEqual([
      {
        args: ["log", "-g", "--format=%gD%x00%H%x00%gs", "--no-show-signature", "--stdin", "--"],
        stdin: "refs/heads/odt/task-1\nrefs/heads/odt/task-2\nrefs/heads/odt/task-3\n",
      },
    ]);
    expect([...(await Effect.runPromise(methods.readReflogs("/repo", [])))]).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("fails on a line that is not a reflog entry", async () => {
    const { methods } = recordingRunner({ ok: true, stdout: "gpg: Signature made today\n" });

    await expect(
      Effect.runPromise(methods.readReflogs("/repo", ["refs/heads/odt/task-1"])),
    ).rejects.toThrow("git log -g returned an invalid reflog line");
  });
});
