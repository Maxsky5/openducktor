import { describe, expect, test } from "bun:test";
import { type GitProviderConfig, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitRemoteEndpoint } from "../../../ports/git-port";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import { createGitlabRepositoryAdapter } from "./repository";

const adapterFor = (endpoints: GitRemoteEndpoint[]) =>
  createGitlabRepositoryAdapter({
    gitPort: createGitPortTestDouble({
      canonicalizePath: (path) => Effect.succeed(path),
      isGitRepository: () => Effect.succeed(true),
      listRemoteEndpoints: () => Effect.succeed(endpoints),
    }),
    connection: { knownInstances: () => Effect.succeed([]) },
  });

const configFor = (remoteName?: string) => {
  const provider: GitProviderConfig = {
    id: "gitlab",
    enabled: true,
    autoDetected: false,
    repository: {
      providerId: "gitlab",
      instanceUrl: "https://gitlab.example.com/gitlab",
      projectPath: "group/app",
    },
  };
  if (remoteName !== undefined) provider.settings = { remoteName };
  return repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultTargetBranch: { remote: "origin", branch: "main" },
    git: { provider },
  });
};

const subPathRemote = (name: string): GitRemoteEndpoint => ({
  name,
  fetchUrls: ["https://gitlab.example.com/gitlab/group/app.git"],
  pushUrls: [],
});

describe("GitLab repository mapping", () => {
  test("maps a named HTTPS remote of an instance with a sub-path", async () => {
    const adapter = adapterFor([subPathRemote("origin"), subPathRemote("mirror")]);
    const mapping = await Effect.runPromise(adapter.getMapping(configFor("origin")));
    expect(mapping.remoteName).toBe("origin");
  });

  test("maps a named remote with an SSH host alias by its project path", async () => {
    const adapter = adapterFor([
      { name: "work", fetchUrls: ["git@gitlab-work:group/app.git"], pushUrls: [] },
    ]);
    const mapping = await Effect.runPromise(adapter.getMapping(configFor("work")));
    expect(mapping.remoteName).toBe("work");
  });

  test("maps a named remote with an HTTPS fetch URL and an SSH host alias push URL", async () => {
    const adapter = adapterFor([
      {
        name: "work",
        fetchUrls: ["https://gitlab.example.com/gitlab/group/app.git"],
        pushUrls: ["git@gitlab-work:group/app.git"],
      },
    ]);
    const mapping = await Effect.runPromise(adapter.getMapping(configFor("work")));
    expect(mapping.remoteName).toBe("work");
  });

  test("refuses a named HTTPS remote on another host", async () => {
    const adapter = adapterFor([
      { name: "origin", fetchUrls: ["https://unrelated.example/group/app.git"], pushUrls: [] },
    ]);
    const failure = await Effect.runPromise(
      adapter.getMapping(configFor("origin")).pipe(Effect.flip),
    );
    expect(failure.message).toContain("does not point to the GitLab project");
  });

  test("asks for one remote when several match", async () => {
    const adapter = adapterFor([subPathRemote("origin"), subPathRemote("mirror")]);
    const failure = await Effect.runPromise(adapter.getMapping(configFor()).pipe(Effect.flip));
    expect(failure.message).toContain("Several local Git remotes");
  });
});

describe("GitLab repository detection", () => {
  test.each([
    [[], "has no origin remote"],
    [
      [{ name: "origin", fetchUrls: ["/srv/git/app.git"], pushUrls: [] }],
      "does not name a GitLab project",
    ],
  ] satisfies [GitRemoteEndpoint[], string][])(
    "explains a repository without a GitLab origin",
    async (endpoints, message) => {
      const failure = await Effect.runPromise(
        adapterFor(endpoints).detectRepository("/repo").pipe(Effect.flip),
      );
      expect(failure.message).toContain(message);
    },
  );
});
