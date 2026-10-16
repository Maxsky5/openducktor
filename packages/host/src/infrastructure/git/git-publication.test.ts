import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createDefaultGitRunner, type GitCommandRunner } from "./git-command-runner";
import { inspectPublication, pushBoundPublication, readPublicationTarget } from "./git-publication";

const runner = createDefaultGitRunner(
  () => ({ ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
  { command: "git" },
);
const git = (directory: string, ...args: string[]) => Effect.runPromise(runner(directory, args));

describe("bound publication", () => {
  test("publishes only the reviewed full ref to every effective endpoint despite push mappings and URL rewrites", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "odt-publication-"));
    const repo = path.join(root, "work");
    const destinations = [path.join(root, "one.git"), path.join(root, "two.git")];
    try {
      await git(root, "init", "--initial-branch=main", repo);
      for (const destination of destinations) await git(root, "init", "--bare", destination);
      await git(repo, "config", "user.name", "Publication test");
      await git(repo, "config", "user.email", "publication@example.invalid");
      await writeFile(path.join(repo, "change.txt"), "reviewed change\n");
      await git(repo, "add", "change.txt");
      await git(repo, "commit", "-m", "Reviewed change");
      await git(repo, "tag", "-a", "extra-tag", "-m", "Must stay local");
      await git(repo, "remote", "add", "origin", "odt-alias:one");
      await git(repo, "config", "--add", "remote.origin.pushurl", "odt-alias:one");
      await git(repo, "config", "--add", "remote.origin.pushurl", "odt-alias:two");
      await git(repo, "config", `url.${root}/.insteadOf`, "odt-alias:");
      await git(repo, "config", `url.${destinations[0]}.insteadOf`, `${root}/one`);
      await git(repo, "config", `url.${destinations[1]}.insteadOf`, `${root}/two`);
      // Git performs one rewrite, so bind directly to paths that exist after that one rewrite.
      await git(repo, "config", "--replace-all", "remote.origin.pushurl", "odt-final:one.git");
      await git(repo, "config", "--add", "remote.origin.pushurl", "odt-final:two.git");
      await git(repo, "config", `url.${root}/.insteadOf`, "odt-final:");
      await git(repo, "config", "remote.origin.push", "refs/heads/main:refs/heads/unreviewed");
      await git(repo, "config", "push.followTags", "true");
      const target = await Effect.runPromise(
        readPublicationTarget(runner, {
          repoPath: repo,
          sourceRef: "refs/heads/main",
          remote: "origin",
          targetRef: "refs/heads/main",
        }),
      );
      expect(target.endpoints.map((endpoint) => endpoint.label)).toEqual(destinations);
      const result = await Effect.runPromise(
        pushBoundPublication(runner, repo, {
          target,
          destinationIdentities: target.endpoints.map((endpoint) => endpoint.identity),
        }),
      );
      expect(result.destinations.map((destination) => destination.outcome)).toEqual([
        "confirmed",
        "confirmed",
      ]);
      expect(
        (await Effect.runPromise(inspectPublication(runner, target))).map((value) => value.oid),
      ).toEqual([target.sourceOid, target.sourceOid]);
      for (const destination of destinations) {
        expect((await git(destination, "for-each-ref", "--format=%(refname)")).stdout.trim()).toBe(
          "refs/heads/main",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Three real repositories, pushes, and ref checks can exceed 5 seconds on Windows CI.
  }, 15_000);

  test("consent identities bind full effective endpoints while labels hide credentials", async () => {
    let endpoint = "alice@host:repo.git";
    const scripted: GitCommandRunner = (_directory, args) =>
      Effect.succeed({
        ok: true,
        stdout: args[0] === "remote" ? endpoint : args[0] === "rev-parse" ? "a".repeat(40) : "",
        stderr: "",
      });
    const read = () =>
      Effect.runPromise(
        readPublicationTarget(scripted, {
          repoPath: "/repo",
          sourceRef: "refs/heads/main",
          remote: "origin",
          targetRef: "refs/heads/main",
        }),
      );
    const first = (await read()).endpoints[0]!;
    endpoint = "bob@host:repo.git";
    const second = (await read()).endpoints[0]!;
    expect(first.label).toBe(second.label);
    expect(first.identity).not.toBe(second.identity);
    endpoint = "https::https://alice:secret@host/repo.git?token=secret";
    const helper = (await read()).endpoints[0]!;
    expect(helper.label).toBe("https::https://host/repo.git");
    expect(helper.label).not.toContain("secret");
    endpoint = "https://host/repo.git?repository=one";
    const one = (await read()).endpoints[0]!;
    endpoint = "https://host/repo.git?repository=two";
    expect((await read()).endpoints[0]!.identity).not.toBe(one.identity);
  });

  test("preserves earlier confirmation and uncertain issuance without exposing native credentials", async () => {
    const oid = "a".repeat(40);
    let pushes = 0;
    const scripted: GitCommandRunner = (_directory, args, options) =>
      Effect.try({
        try: () => {
          if (args[0] === "rev-parse") return { ok: true, stdout: oid, stderr: "" };
          if (args[0] === "remote")
            return {
              ok: true,
              stdout:
                "https://user:secret@example.invalid/one?token=secret\nhttps://user:secret@example.invalid/two\n",
              stderr: "",
            };
          if (args.includes("push")) {
            pushes += 1;
            options?.onStarted?.();
            if (pushes === 2) throw new Error("https://user:secret@example.invalid/two failed");
            return { ok: true, stdout: `*\t${oid}:refs/heads/main\t[new branch]\n`, stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
        catch: (cause) => new HostOperationError({ operation: "test", message: String(cause) }),
      });
    const target = await Effect.runPromise(
      readPublicationTarget(scripted, {
        repoPath: "/repo",
        sourceRef: "refs/heads/main",
        remote: "origin",
        targetRef: "refs/heads/main",
      }),
    );
    expect(
      target.endpoints.every(
        (endpoint) => !endpoint.label.includes("secret") && !endpoint.label.includes("user"),
      ),
    ).toBe(true);
    const result = await Effect.runPromise(
      Effect.result(
        pushBoundPublication(scripted, "/repo", {
          target,
          destinationIdentities: target.endpoints.map((endpoint) => endpoint.identity),
        }),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        publication: { destinations: [{ outcome: "confirmed" }, { outcome: "uncertain" }] },
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
