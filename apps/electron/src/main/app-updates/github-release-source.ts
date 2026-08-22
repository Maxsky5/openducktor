import { hasRuntimeType } from "@openducktor/contracts";
import { compare, prerelease, valid } from "semver";
import type { JsonValue } from "@openducktor/contracts";

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

const readObject = (
  value: JsonValue | undefined,
  description: string,
): Record<string, JsonValue> => {
  if (!hasRuntimeType(value, "object") || value === null || Array.isArray(value)) {
    throw new Error(`${description} is not an object.`);
  }
  return value;
};

const readString = (
  value: Record<string, JsonValue>,
  property: string,
  description: string,
): string => {
  const propertyValue = value[property];
  if (!hasRuntimeType(propertyValue, "string") || propertyValue.length === 0) {
    throw new Error(`${description} has no ${property}.`);
  }
  return propertyValue;
};

const readBoolean = (
  value: Record<string, JsonValue>,
  property: string,
  description: string,
): boolean => {
  const propertyValue = value[property];
  if (!hasRuntimeType(propertyValue, "boolean")) {
    throw new Error(`${description} has no valid ${property}.`);
  }
  return propertyValue;
};

const readRelease = (value: JsonValue | undefined): Omit<GitHubRelease, "version"> => {
  const release = readObject(value, "GitHub release");
  const tagName = readString(release, "tag_name", "GitHub release");
  return {
    prerelease: readBoolean(release, "prerelease", "GitHub release"),
    tagName,
  };
};

const parseRelease = (value: JsonValue | undefined): GitHubRelease => {
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

const readJson = async (
  response: Response,
  description: string,
): Promise<JsonValue | undefined> => {
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}.`);
  }
  // SAFETY: Response.json returns parsed JSON wire data.
  return (await response.json()) as JsonValue | undefined;
};

const parseReleasePage = (value: JsonValue | undefined): GitHubRelease[] => {
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
): Promise<{ response: Response; value: JsonValue | undefined }> => {
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
