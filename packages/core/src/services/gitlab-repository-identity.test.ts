import { describe, expect, test } from "bun:test";
import {
  canonicalGitlabInstanceUrl,
  gitlabInstanceLabel,
  gitlabRepositoryFromRemote,
  gitlabRepositoryKey,
  gitlabResolvedRepositoryIdentity,
  gitlabTokenPageUrl,
  isGitlabHost,
  parseGitlabRemoteUrl,
} from "./gitlab-repository-identity";

const fromRemote = (url: string, known: string[] = []) => {
  const remote = parseGitlabRemoteUrl(url);
  return remote ? gitlabRepositoryFromRemote(remote, known) : null;
};

describe("GitLab repository identity", () => {
  test("canonicalizes instance URLs and keeps a sub-path", () => {
    expect(canonicalGitlabInstanceUrl("HTTPS://GitLab.Example.com:443/GitLab/")).toBe(
      "https://gitlab.example.com/GitLab",
    );
    expect(gitlabInstanceLabel("https://gitlab.com/")).toBe("gitlab.com");
    expect(gitlabInstanceLabel("http://code.corp:8080")).toBe("http://code.corp:8080");
  });

  test("keys projects case-insensitively and resolved projects by ID", () => {
    expect(
      gitlabRepositoryKey({
        providerId: "gitlab",
        instanceUrl: "https://GITLAB.com/",
        projectPath: "Group/Sub/App",
      }),
    ).toBe("gitlab::https://gitlab.com::group/sub/app");
    expect(
      gitlabResolvedRepositoryIdentity({ instanceUrl: "https://gitlab.com/", projectId: 42 }),
    ).toBe("gitlab::https://gitlab.com::42");
  });

  test("builds the token page URL with the name and api scope", () => {
    expect(gitlabTokenPageUrl("https://example.com/gitlab/")).toBe(
      "https://example.com/gitlab/-/user_settings/personal_access_tokens?name=OpenDucktor&scopes=api",
    );
  });

  test("reads HTTPS, SCP, and SSH remotes with nested groups", () => {
    expect(fromRemote("https://gitlab.com/group/sub/project.git")).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://gitlab.com",
      projectPath: "group/sub/project",
    });
    expect(fromRemote("git@gitlab.example.com:group/project.git")).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://gitlab.example.com",
      projectPath: "group/project",
    });
    expect(fromRemote("ssh://git@gitlab.example.com:2222/group/project")).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://gitlab.example.com",
      projectPath: "group/project",
    });
    expect(fromRemote("https://gitlab.com/project-only")).toBeNull();
    expect(fromRemote("/local/path")).toBeNull();
  });

  test("uses a known instance sub-path for web and SSH remotes", () => {
    const known = ["https://example.com/gitlab"];
    expect(fromRemote("https://example.com/gitlab/group/project.git", known)).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://example.com/gitlab",
      projectPath: "group/project",
    });
    expect(fromRemote("git@example.com:group/project.git", known)).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://example.com/gitlab",
      projectPath: "group/project",
    });
    expect(fromRemote("https://example.com/other/project.git", known)).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://example.com",
      projectPath: "other/project",
    });
  });

  test("detects GitLab hosts by name and by known instance", () => {
    expect(isGitlabHost("gitlab.com", [])).toBe(true);
    expect(isGitlabHost("Code-GitLab.corp", [])).toBe(true);
    expect(isGitlabHost("code.corp", ["https://code.corp/gitlab"])).toBe(true);
    expect(isGitlabHost("github.com", [])).toBe(false);
  });
});
