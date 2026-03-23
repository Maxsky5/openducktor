import { describe, expect, test } from "bun:test";
import {
  gitProviderRepositoryKey,
  parseGitProviderRepositoryFromRemoteUrl,
} from "./git-provider-repository";

describe("git provider repository parsing", () => {
  test("parses scp-style git remotes", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl("git@github.com:openai/openducktor.git"),
    ).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("parses https remotes with full owner/repo path", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl("https://github.com/openai/openducktor.git"),
    ).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("parses https remotes with userinfo", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl(
        "https://token@github.mycorp.com/openai/openducktor.git",
      ),
    ).toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("parses ssh url remotes", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl("ssh://git@github.mycorp.com/openai/openducktor.git"),
    ).toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("returns null for unsupported or incomplete remotes", () => {
    expect(parseGitProviderRepositoryFromRemoteUrl("")).toBeNull();
    expect(parseGitProviderRepositoryFromRemoteUrl("git@github.com")).toBeNull();
    expect(parseGitProviderRepositoryFromRemoteUrl("https://github.com/openai")).toBeNull();
    expect(parseGitProviderRepositoryFromRemoteUrl("file:///tmp/repo")).toBeNull();
  });

  test("builds a canonical repository key", () => {
    expect(
      gitProviderRepositoryKey({
        host: "GitHub.COM",
        owner: "OpenAI",
        name: "OpenDucktor",
      }),
    ).toBe("github.com::openai::openducktor");
  });
});
