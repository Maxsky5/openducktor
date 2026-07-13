import { describe, expect, mock, test } from "bun:test";
import { createGitHubReleaseSource } from "./github-release-source";

const release = (tagName: string, isPrerelease = tagName.includes("-")) => ({
  prerelease: isPrerelease,
  tag_name: tagName,
});

describe("GitHub release source", () => {
  test("uses GitHub's stable latest-release endpoint", async () => {
    const fetch = mock(async () => Response.json(release("v0.5.0", false)));
    const source = createGitHubReleaseSource({ fetch, owner: "Maxsky5", repo: "openducktor" });

    await expect(source.resolve(null)).resolves.toMatchObject({ version: "0.5.0" });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/Maxsky5/openducktor/releases/latest",
    );
  });

  test("paginates prereleases and selects the greatest matching semver", async () => {
    const fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("page=1")) {
        return Response.json([release("v0.6.0-alpha.9"), release("v0.5.0-beta.12")], {
          headers: {
            link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next"',
          },
        });
      }
      return Response.json([release("v0.5.0-beta.2"), release("v0.6.0-beta.1")]);
    });
    const source = createGitHubReleaseSource({ fetch, owner: "Maxsky5", repo: "openducktor" });

    await expect(source.resolve("beta")).resolves.toMatchObject({ version: "0.6.0-beta.1" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("discovers prerelease channels whose first identifier is numeric", async () => {
    const source = createGitHubReleaseSource({
      fetch: mock(async () => Response.json([release("v0.6.0-1.2"), release("v0.6.0-2.1")])),
      owner: "Maxsky5",
      repo: "openducktor",
    });

    await expect(source.resolve("1")).resolves.toMatchObject({ version: "0.6.0-1.2" });
  });

  test("rejects a release tag that is not valid semver", async () => {
    const source = createGitHubReleaseSource({
      fetch: mock(async () => Response.json(release("nightly", false))),
      owner: "Maxsky5",
      repo: "openducktor",
    });

    await expect(source.resolve(null)).rejects.toThrow("not a valid OpenDucktor version");
  });
});
