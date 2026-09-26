import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type GithubGitProviderRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import type { GithubCli, ResolvedGithubCli } from "./cli";
import { createGithubIssueReader } from "./issues";

const repository: GithubGitProviderRepository = {
  host: "github.com",
  owner: "example",
  name: "repo",
};
const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: { provider: { id: "github", enabled: true, repository } },
});
const repositoryPort: GitProviderRepositoryPort<GithubGitProviderRepository> = {
  detectRepository: () => Effect.die("Unexpected repository detection"),
  getRepository: () => Effect.succeed(repository),
  getMapping: () => Effect.die("Unexpected repository mapping"),
};

const issue = (
  number: number,
  extra: { state?: string; pull_request?: { url?: string } } = {},
) => ({
  number,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  state: "open",
  updated_at: "2026-09-23T11:00:00Z",
  html_url: `https://github.com/example/repo/issues/${number}`,
  user: { login: "octocat" },
  labels: [{ name: "triage" }],
  ...extra,
});

const fixture = (
  searchItems: unknown[],
  directIssue: ReturnType<typeof issue> | null = issue(1),
  lookupResult?: { ok: boolean; stdout: string; stderr: string },
) => {
  const calls: string[][] = [];
  const command: ResolvedGithubCli = {
    executablePath: "gh",
    getAuth: () => Effect.die("Unexpected auth request"),
    readVersion: () => Effect.die("Unexpected version request"),
    run: (args) => {
      calls.push(args);
      const isSearch = args.includes("search/issues");
      const isNumberLookup = args.includes("graphql");
      if (isNumberLookup && lookupResult) return Effect.succeed(lookupResult);
      const missingNumber = isNumberLookup && (!directIssue || directIssue.pull_request);
      return Effect.succeed({
        ok: !missingNumber,
        stdout: JSON.stringify(
          isSearch
            ? { total_count: 2, incomplete_results: false, items: searchItems }
            : isNumberLookup
              ? {
                  data: {
                    repository: {
                      issue:
                        directIssue && !directIssue.pull_request
                          ? {
                              number: directIssue.number,
                              title: directIssue.title,
                              body: directIssue.body,
                              state: directIssue.state.toUpperCase(),
                              updatedAt: directIssue.updated_at,
                              url: directIssue.html_url,
                              author: directIssue.user,
                              labels: { nodes: directIssue.labels },
                            }
                          : null,
                    },
                  },
                  errors: missingNumber
                    ? [
                        {
                          type: "NOT_FOUND",
                          path: ["repository", "issue"],
                          message: "Could not resolve to an Issue with that number.",
                        },
                      ]
                    : undefined,
                }
              : directIssue,
        ),
        stderr: missingNumber ? "gh: Could not resolve to an Issue with that number." : "",
      });
    },
  };
  const githubCli: GithubCli = { resolve: () => Effect.succeed(command) };
  return { reader: createGithubIssueReader({ githubCli, repositoryPort }), calls };
};

describe("GitHub issue reader", () => {
  test("reads a private attachment through authenticated GitHub CLI output", async () => {
    const url = "https://github.com/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
    const calls: Array<{
      args: string[];
      options: { stdoutEncoding?: string; maxStdoutBytes?: number } | undefined;
    }> = [];
    const reader = createGithubIssueReader({
      repositoryPort,
      githubCli: {
        resolve: () =>
          Effect.succeed({
            executablePath: "gh",
            getAuth: () => Effect.die("Unexpected auth request"),
            readVersion: () => Effect.die("Unexpected version request"),
            run: (args, options) => {
              calls.push({ args, options });
              return Effect.succeed({
                ok: true,
                stdout: args.includes(url)
                  ? png
                  : JSON.stringify({ body: `Image: ![Screenshot](${url})` }),
                stderr: "",
              });
            },
          }),
      },
    });

    const image = await Effect.runPromise(reader.readImage!({ repoConfig, sourceId: "132", url }));
    expect(image).toEqual({ mediaType: "image/png", bytesBase64: png });
    expect(calls[0]?.args).toContain("repos/example/repo/issues/132");
    expect(calls[1]?.args).toContain(url);
    expect(calls[1]?.options).toMatchObject({
      stdoutEncoding: "base64",
      maxStdoutBytes: 10 * 1024 * 1024,
    });
  });

  test("does not send an unrelated attachment URL to GitHub CLI", async () => {
    const url = "https://github.com/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9";
    const { reader, calls } = fixture([], { ...issue(132), body: "No image here" });
    await expect(
      Effect.runPromise(reader.readImage!({ repoConfig, sourceId: "132", url })),
    ).rejects.toThrow("not in the source Issue");
    expect(calls).toHaveLength(1);
    await expect(
      Effect.runPromise(
        reader.readImage!({
          repoConfig,
          sourceId: "132",
          url: "https://evil.example/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9",
        }),
      ),
    ).rejects.toThrow("not a GitHub Issue attachment");
    await expect(
      Effect.runPromise(reader.readImage!({ repoConfig, sourceId: "132", url: "not-a-url" })),
    ).rejects.toThrow("image URL is invalid");
    expect(calls).toHaveLength(1);
  });

  test("filters Pull Requests and closed search results while keeping an open Issue", async () => {
    const { reader, calls } = fixture([
      issue(1),
      issue(2, { pull_request: { url: "https://api.github.com/pulls/2" } }),
      issue(3, { state: "closed" }),
    ]);
    const result = await Effect.runPromise(
      reader.list({ repoConfig, search: "fix crash", page: 1 }),
    );

    expect(result.items).toMatchObject([{ sourceId: "1", title: "Issue 1", tags: ["triage"] }]);
    expect(calls[0]).toContain('q=repo:example/repo is:issue is:open in:title "fix crash"');
    expect(calls[0]).toContain("per_page=20");
  });

  test.each(["132", "#132"])("finds an open Issue by number from %s", async (search) => {
    const { reader, calls } = fixture([], issue(132));
    const result = await Effect.runPromise(reader.list({ repoConfig, search, page: 1 }));

    expect(result.items).toMatchObject([{ sourceId: "132", number: "132" }]);
    expect(result.nextPage).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("graphql");
    expect(calls[0]).not.toContain("search/issues");
    const nextPage = await Effect.runPromise(reader.list({ repoConfig, search, page: 2 }));
    expect(nextPage.items).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("returns no result when a GitHub issue number does not exist", async () => {
    const { reader } = fixture([], null);
    const result = await Effect.runPromise(reader.list({ repoConfig, search: "134", page: 1 }));
    expect(result.items).toEqual([]);
  });

  test("reports a missing or inaccessible repository during number search", async () => {
    const { reader } = fixture([], null, {
      ok: false,
      stdout: JSON.stringify({
        data: { repository: null },
        errors: [
          {
            type: "NOT_FOUND",
            path: ["repository"],
            message: "Could not resolve to a Repository with the name 'example/repo'.",
          },
        ],
      }),
      stderr: "gh: Could not resolve to a Repository with the name 'example/repo'.",
    });
    await expect(
      Effect.runPromise(reader.list({ repoConfig, search: "134", page: 1 })),
    ).rejects.toThrow("Could not resolve to a Repository");
  });

  test("reports a GitHub CLI failure during number search", async () => {
    const { reader } = fixture([], null, {
      ok: false,
      stdout: "",
      stderr: "gh: authentication required",
    });
    await expect(
      Effect.runPromise(reader.list({ repoConfig, search: "134", page: 1 })),
    ).rejects.toThrow("authentication required");
  });

  test.each([
    issue(132, { state: "closed" }),
    issue(132, { pull_request: { url: "https://api.github.com/pulls/132" } }),
  ])("does not list a closed Issue or Pull Request found by number", async (directIssue) => {
    const { reader } = fixture([], directIssue);
    const result = await Effect.runPromise(reader.list({ repoConfig, search: "132", page: 1 }));

    expect(result.items).toEqual([]);
    expect(result.nextPage).toBeUndefined();
  });

  test("keeps an HTML issue image as an image in the Task description", async () => {
    const body =
      'Here is an image:\n\n<img width="728" alt="Screen [one]" src="https://github.com/user-attachments/assets/abc" />\n\n```html\n<img src="https://example.com/code" />\n```';
    const { reader } = fixture([{ ...issue(132), body }]);
    const result = await Effect.runPromise(reader.list({ repoConfig, search: "", page: 1 }));

    expect(result.items[0]?.description).toBe(
      'Here is an image:\n\n![Screen \\[one\\]](https://github.com/user-attachments/assets/abc)\n\n```html\n<img src="https://example.com/code" />\n```',
    );
  });

  test("does not turn an unsafe HTML image source into Markdown", async () => {
    const body = '<img alt="unsafe" src="javascript:alert(1)" />';
    const { reader } = fixture([{ ...issue(132), body }]);
    const result = await Effect.runPromise(reader.list({ repoConfig, search: "", page: 1 }));

    expect(result.items[0]?.description).toBe(body);
  });

  test("rejects a Pull Request on the direct read before import", async () => {
    const issuePort = createGithubIssueReader({
      repositoryPort,
      githubCli: {
        resolve: () =>
          Effect.succeed({
            executablePath: "gh",
            getAuth: () => Effect.die("Unexpected auth request"),
            readVersion: () => Effect.die("Unexpected version request"),
            run: () =>
              Effect.succeed({
                ok: true,
                stdout: JSON.stringify(issue(1, { pull_request: {} })),
                stderr: "",
              }),
          }),
      },
    });
    await expect(Effect.runPromise(issuePort.get({ repoConfig, sourceId: "1" }))).rejects.toThrow(
      "not an open Issue",
    );
  });
});
