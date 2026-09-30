import { z } from "zod";

/** The latest published stable release: the version and the page of its release notes. */
export type Release = { version: string; notes: string };

const releaseSchema = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/),
  html_url: z.url(),
  draft: z.literal(false),
  prerelease: z.literal(false),
});

/**
 * Reads the latest release from GitHub. GitHub never gives a draft or a prerelease as the latest
 * release, so a release that main prepares does not show before it is public. A token raises the
 * rate limit of the API; CI passes the workflow token.
 */
export async function readLatestRelease(
  repository: string,
  token: string | undefined,
): Promise<Release> {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error(
      `The site build reads the latest release from ${url}. Connect to the network, then build again.`,
      { cause: error },
    );
  }
  if (!response.ok)
    throw new Error(
      `GitHub returned ${response.status} for the latest release. Set GITHUB_TOKEN when the rate limit is the cause.`,
    );
  const release = releaseSchema.parse(await response.json());
  return { version: release.tag_name.slice(1), notes: release.html_url };
}
