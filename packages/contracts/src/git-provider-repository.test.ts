import { describe, expect, test } from "bun:test";
import { gitRepositoryKey, parseGitRepositoryUrl } from "./git-provider-repository";

describe("git provider repository parsing", () => {
  test("parses scp-style git remotes", () => {
    expect(parseGitRepositoryUrl("git@github.com:openai/openducktor.git")).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("parses https remotes with full owner/repo path", () => {
    expect(parseGitRepositoryUrl("https://github.com/openai/openducktor.git")).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("parses https remotes with userinfo", () => {
    expect(parseGitRepositoryUrl("https://token@github.mycorp.com/openai/openducktor.git")).toEqual(
      {
        host: "github.mycorp.com",
        owner: "openai",
        name: "openducktor",
      },
    );
  });

  test("parses ssh url remotes", () => {
    expect(parseGitRepositoryUrl("ssh://git@github.mycorp.com/openai/openducktor.git")).toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("uses the API host for ssh URLs with a transport port", () => {
    expect(
      parseGitRepositoryUrl("ssh://git@github.mycorp.com:2222/openai/openducktor.git"),
    ).toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("keeps a non-default HTTPS port in the parsed host", () => {
    expect(parseGitRepositoryUrl("https://github.mycorp.com:8443/openai/openducktor.git")).toEqual({
      host: "github.mycorp.com:8443",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("returns null for unsupported or incomplete remotes", () => {
    expect(parseGitRepositoryUrl("")).toBeNull();
    expect(parseGitRepositoryUrl("git@github.com")).toBeNull();
    expect(parseGitRepositoryUrl("https://github.com/openai")).toBeNull();
    expect(parseGitRepositoryUrl("https://github.com/openai/openducktor/extra")).toBeNull();
    expect(parseGitRepositoryUrl("file:///tmp/repo")).toBeNull();
  });

  test("builds a canonical repository key", () => {
    expect(
      gitRepositoryKey({
        host: "GitHub.COM",
        owner: "OpenAI",
        name: "OpenDucktor",
      }),
    ).toBe("github.com::openai::openducktor");
  });
});
