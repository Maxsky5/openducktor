import { describe, expect, test } from "bun:test";
import type { ProcessRunner } from "./beads-runtime";
import {
  DefaultCanonicalPullRequestResolver,
  type ResolveCanonicalPullRequestInput,
} from "./canonical-pull-request-resolver";

const FIXED_TIMESTAMP = "2026-03-23T10:00:00.000Z";

const makeResolver = (
  runProcess: ProcessRunner,
  now = () => FIXED_TIMESTAMP,
): DefaultCanonicalPullRequestResolver => {
  return new DefaultCanonicalPullRequestResolver("/repo", {
    runProcess,
    now,
  });
};

describe("DefaultCanonicalPullRequestResolver", () => {
  test("fetches canonical GitHub pull request metadata by provider and number", async () => {
    const commands: string[] = [];
    const runProcess: ProcessRunner = async (command, args) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "git" && args.join(" ") === "remote") {
        return { ok: true, stdout: "origin", stderr: "" };
      }
      if (command === "git" && args.join(" ") === "remote get-url origin") {
        return { ok: true, stdout: "git@github.com:openai/openducktor.git", stderr: "" };
      }
      if (
        command === "gh" &&
        args.join(" ") === "api --method GET repos/openai/openducktor/pulls/42"
      ) {
        return {
          ok: true,
          stdout: JSON.stringify({
            number: 42,
            html_url: "https://github.com/openai/openducktor/pull/42",
            draft: false,
            state: "open",
            created_at: "2026-03-11T10:00:00Z",
            updated_at: "2026-03-11T10:05:00Z",
            merged_at: null,
            closed_at: null,
            head: { ref: "odt/task-1" },
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const resolver = makeResolver(runProcess);

    await expect(resolver.resolve({ providerId: "github", number: 42 })).resolves.toEqual({
      providerId: "github",
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open",
      createdAt: "2026-03-11T10:00:00Z",
      updatedAt: "2026-03-11T10:05:00Z",
      lastSyncedAt: FIXED_TIMESTAMP,
    });
    expect(commands).toEqual([
      "git remote",
      "git remote get-url origin",
      "gh api --method GET repos/openai/openducktor/pulls/42",
    ]);
  });

  test("prefers the origin remote when multiple repositories are configured", async () => {
    const commands: string[] = [];
    const runProcess: ProcessRunner = async (command, args) => {
      commands.push(`${command} ${args.join(" ")}`);
      const signature = `${command} ${args.join(" ")}`;
      if (signature === "git remote") {
        return { ok: true, stdout: "upstream\norigin", stderr: "" };
      }
      if (signature === "git remote get-url upstream") {
        return { ok: true, stdout: "git@github.com:other/repo.git", stderr: "" };
      }
      if (signature === "git remote get-url origin") {
        return { ok: true, stdout: "git@github.mycorp.com:openai/openducktor.git", stderr: "" };
      }
      if (
        signature ===
        "gh --hostname github.mycorp.com api --method GET repos/openai/openducktor/pulls/7"
      ) {
        return {
          ok: true,
          stdout: JSON.stringify({
            number: 7,
            html_url: "https://github.mycorp.com/openai/openducktor/pull/7",
            draft: true,
            state: "open",
            created_at: "2026-03-11T10:00:00Z",
            updated_at: "2026-03-11T10:05:00Z",
            merged_at: null,
            closed_at: null,
            head: { ref: "odt/task-1" },
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${signature}`);
    };
    const resolver = makeResolver(runProcess);

    await expect(resolver.resolve({ providerId: "github", number: 7 })).resolves.toMatchObject({
      providerId: "github",
      number: 7,
      state: "draft",
      url: "https://github.mycorp.com/openai/openducktor/pull/7",
    });
    expect(commands).toEqual([
      "git remote",
      "git remote get-url upstream",
      "git remote get-url origin",
      "gh --hostname github.mycorp.com api --method GET repos/openai/openducktor/pulls/7",
    ]);
  });

  test("parses https remotes while resolving canonical pull requests", async () => {
    const commands: string[] = [];
    const runProcess: ProcessRunner = async (command, args) => {
      const signature = `${command} ${args.join(" ")}`;
      commands.push(signature);
      if (signature === "git remote") {
        return { ok: true, stdout: "origin", stderr: "" };
      }
      if (signature === "git remote get-url origin") {
        return { ok: true, stdout: "https://github.com/openai/openducktor.git", stderr: "" };
      }
      if (signature === "gh api --method GET repos/openai/openducktor/pulls/42") {
        return {
          ok: true,
          stdout: JSON.stringify({
            number: 42,
            html_url: "https://github.com/openai/openducktor/pull/42",
            draft: false,
            state: "open",
            created_at: "2026-03-11T10:00:00Z",
            updated_at: "2026-03-11T10:05:00Z",
            merged_at: null,
            closed_at: null,
            head: { ref: "odt/task-1" },
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${signature}`);
    };
    const resolver = makeResolver(runProcess);

    await expect(resolver.resolve({ providerId: "github", number: 42 })).resolves.toMatchObject({
      providerId: "github",
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
    });
    expect(commands).toEqual([
      "git remote",
      "git remote get-url origin",
      "gh api --method GET repos/openai/openducktor/pulls/42",
    ]);
  });

  test("fails fast when the repository cannot be resolved uniquely", async () => {
    const runProcess: ProcessRunner = async (command, args) => {
      const signature = `${command} ${args.join(" ")}`;
      if (signature === "git remote") {
        return { ok: true, stdout: "upstream\nmirror", stderr: "" };
      }
      if (signature === "git remote get-url upstream") {
        return { ok: true, stdout: "git@github.com:other/repo.git", stderr: "" };
      }
      if (signature === "git remote get-url mirror") {
        return { ok: true, stdout: "git@github.com:openai/openducktor.git", stderr: "" };
      }
      throw new Error(`unexpected command: ${signature}`);
    };
    const resolver = makeResolver(runProcess);

    await expect(
      resolver.resolve({
        providerId: "github",
        number: 1,
      } satisfies ResolveCanonicalPullRequestInput),
    ).rejects.toThrow(
      "Unable to resolve a single GitHub repository for odt_set_pull_request. Configure a unique origin remote for this repository.",
    );
  });
});
