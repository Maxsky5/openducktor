import { compare, prerelease, valid } from "semver";

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

const readObject = (value: unknown, description: string): object => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} is not an object.`);
  }
  return value;
};

const readString = (value: object, property: string, description: string): string => {
  const propertyValue = Reflect.get(value, property);
  if (typeof propertyValue !== "string" || propertyValue.length === 0) {
    throw new Error(`${description} has no ${property}.`);
  }
  return propertyValue;
};

const readBoolean = (value: object, property: string, description: string): boolean => {
  const propertyValue = Reflect.get(value, property);
  if (typeof propertyValue !== "boolean") {
    throw new Error(`${description} has no valid ${property}.`);
  }
  return propertyValue;
};

const parseRelease = (value: unknown): GitHubRelease => {
  const release = readObject(value, "GitHub release");
  const tagName = readString(release, "tag_name", "GitHub release");
  const version = valid(tagName);
  if (!version) {
    throw new Error(`GitHub release ${tagName} is not a valid OpenDucktor version.`);
  }
  return {
    prerelease: readBoolean(release, "prerelease", "GitHub release"),
    tagName,
    version,
  };
};

const readJson = async (response: Response, description: string): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}.`);
  }
  return response.json();
};

const parseReleasePage = (value: unknown): GitHubRelease[] => {
  if (!Array.isArray(value)) {
    throw new Error("GitHub releases response is not an array.");
  }
  return value.map(parseRelease);
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
    const response = await fetch(`${releasesUrl}?per_page=100&page=${page}`, {
      headers: apiHeaders,
    });
    const releases = parseReleasePage(await readJson(response, "GitHub releases request"));
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
      const response = await fetch(`${releasesUrl}/latest`, { headers: apiHeaders });
      const release = parseRelease(await readJson(response, "Latest GitHub release request"));
      if (release.prerelease) {
        throw new Error(`GitHub latest release ${release.tagName} is unexpectedly a prerelease.`);
      }
      return release;
    },
  };
};
