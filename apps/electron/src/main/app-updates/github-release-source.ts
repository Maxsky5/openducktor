import { type JsonValue, jsonValueSchema } from "@openducktor/contracts";
import { compare, prerelease, valid } from "semver";
import { z } from "zod";

export type GitHubRelease = {
  prerelease: boolean;
  tagName: string;
  version: string;
};

export type GitHubReleaseSource = {
  resolve(channel: string | null): Promise<GitHubRelease>;
};

type GitHubReleaseSourceOptions = {
  fetch: typeof globalThis.fetch;
  owner: string;
  repo: string;
};

const apiHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const GITHUB_RELEASE_REQUEST_TIMEOUT_MS = 15_000;

const githubReleasePayloadSchema = z.object({
  prerelease: z.boolean(),
  tag_name: z.string().min(1),
});

const readRelease = (value: JsonValue): Omit<GitHubRelease, "version"> => {
  const parsed = githubReleasePayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`GitHub release is invalid: ${parsed.error.message}`);
  }
  return {
    prerelease: parsed.data.prerelease,
    tagName: parsed.data.tag_name,
  };
};

const parseRelease = (value: JsonValue): GitHubRelease => {
  const release = readRelease(value);
  const { tagName } = release;
  const version = valid(tagName);
  if (!version) {
    throw new Error(`GitHub release ${tagName} is not a valid OpenDucktor version.`);
  }
  return {
    ...release,
    version,
  };
};

const readJson = async (response: Response, description: string): Promise<JsonValue> => {
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}.`);
  }
  return jsonValueSchema.parse(await response.json());
};

const parseReleasePage = (value: JsonValue): GitHubRelease[] => {
  if (!Array.isArray(value)) {
    throw new Error("GitHub releases response is not an array.");
  }
  return value.flatMap((item) => {
    const release = readRelease(item);
    const version = valid(release.tagName);
    return version ? [{ ...release, version }] : [];
  });
};

const fetchReleaseJson = async (
  fetch: typeof globalThis.fetch,
  url: string,
  description: string,
): Promise<{ response: Response; value: JsonValue }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GITHUB_RELEASE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: apiHeaders,
      signal: controller.signal,
    });
    return { response, value: await readJson(response, description) };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error(`${description} timed out.`, { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
};

const hasNextPage = (response: Response): boolean =>
  response.headers
    .get("link")
    ?.split(",")
    .some((link) => /;\s*rel="next"\s*$/.test(link)) ?? false;

const matchesChannel = (release: GitHubRelease, channel: string): boolean => {
  if (!release.prerelease) {
    return false;
  }
  const identifiers = prerelease(release.version);
  return identifiers?.[0]?.toString() === channel;
};

const resolvePrerelease = async (
  fetch: typeof globalThis.fetch,
  releasesUrl: string,
  channel: string,
): Promise<GitHubRelease> => {
  let page = 1;
  let selected: GitHubRelease | undefined;

  while (true) {
    const { response, value } = await fetchReleaseJson(
      fetch,
      `${releasesUrl}?per_page=100&page=${page}`,
      "GitHub releases request",
    );
    const releases = parseReleasePage(value);
    for (const release of releases) {
      if (
        matchesChannel(release, channel) &&
        (!selected || compare(release.version, selected.version) > 0)
      ) {
        selected = release;
      }
    }
    if (!hasNextPage(response)) {
      break;
    }
    page += 1;
  }

  if (!selected) {
    throw new Error(`GitHub has no ${channel} OpenDucktor release.`);
  }
  return selected;
};

export const compareReleaseVersions = (left: string, right: string): number => {
  if (!valid(left) || !valid(right)) {
    throw new Error(`Cannot compare invalid release versions ${left} and ${right}.`);
  }
  return compare(left, right);
};

export const createGitHubReleaseSource = ({
  fetch,
  owner,
  repo,
}: GitHubReleaseSourceOptions): GitHubReleaseSource => {
  const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
  return {
    resolve: async (channel) => {
      if (channel !== null) {
        return resolvePrerelease(fetch, releasesUrl, channel);
      }
      const { value } = await fetchReleaseJson(
        fetch,
        `${releasesUrl}/latest`,
        "Latest GitHub release request",
      );
      const release = parseRelease(value);
      if (release.prerelease) {
        throw new Error(`GitHub latest release ${release.tagName} is unexpectedly a prerelease.`);
      }
      return release;
    },
  };
};
