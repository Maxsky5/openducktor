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

  test("uses the API host for ssh URLs with a transport port", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl(
        "ssh://git@github.mycorp.com:2222/openai/openducktor.git",
      ),
    ).toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("keeps an HTTPS port that is part of an enterprise API host", () => {
    expect(
      parseGitProviderRepositoryFromRemoteUrl(
        "https://github.mycorp.com:8443/openai/openducktor.git",
      ),
    ).toEqual({
      host: "github.mycorp.com:8443",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("returns null for unsupported or incomplete remotes", () => {
    expect(parseGitProviderRepositoryFromRemoteUrl("")).toBeNull();
    expect(parseGitProviderRepositoryFromRemoteUrl("git@github.com")).toBeNull();
    expect(parseGitProviderRepositoryFromRemoteUrl("https://github.com/openai")).toBeNull();
    expect(
      parseGitProviderRepositoryFromRemoteUrl("https://github.com/openai/openducktor/extra"),
    ).toBeNull();
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
