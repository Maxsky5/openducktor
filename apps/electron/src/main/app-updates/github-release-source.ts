import { compare, prerelease, valid } from "semver";
import { Effect } from "effect";
import { z } from "zod";
import { runElectronEffect } from "../../effect/electron-boundary";
import {
  ElectronOperationError,
  type ElectronOperationErrorAggregate,
  ElectronValidationError,
  type ElectronValidationErrorAggregate,
  errorMessage,
} from "../../effect/electron-errors";

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

const githubReleaseCandidateSchema = z.object({
  prerelease: z.unknown().optional(),
  tag_name: z.unknown().optional(),
});
const githubReleasePageSchema = z.array(z.unknown());

const invalidReleaseObject = (cause: z.ZodError): ElectronValidationError =>
  new ElectronValidationError({
    operation: "electron.update.parse-github-release",
    message: "GitHub release is not an object.",
    field: "release",
    cause,
  });

const readRelease = (
  candidate: z.output<typeof githubReleaseCandidateSchema>,
): Effect.Effect<Omit<GitHubRelease, "version">, ElectronValidationError> => {
  const tagName = z.string().min(1).safeParse(candidate.tag_name);
  if (!tagName.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.update.parse-github-release",
        message: "GitHub release has no tag_name.",
        field: "tag_name",
        cause: tagName.error,
      }),
    );
  }
  const prereleaseResult = z.boolean().safeParse(candidate.prerelease);
  if (!prereleaseResult.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.update.parse-github-release",
        message: "GitHub release has no valid prerelease.",
        field: "prerelease",
        cause: prereleaseResult.error,
      }),
    );
  }
  return Effect.succeed({ prerelease: prereleaseResult.data, tagName: tagName.data });
};

const parseRelease = (
  candidate: z.output<typeof githubReleaseCandidateSchema>,
): Effect.Effect<GitHubRelease, ElectronValidationErrorAggregate> =>
  Effect.gen(function* () {
    const release = yield* readRelease(candidate);
    const { tagName } = release;
    const version = valid(tagName);
    if (!version) {
      return yield* Effect.fail(
        new ElectronValidationError({
          operation: "electron.update.parse-github-release-version",
          message: `GitHub release ${tagName} is not a valid OpenDucktor version.`,
          field: "tag_name",
          details: { tagName },
        }),
      );
    }
    return { ...release, version };
  });

const parseReleasePage = (
  items: z.output<typeof githubReleasePageSchema>,
): Effect.Effect<GitHubRelease[], ElectronValidationError> =>
  Effect.gen(function* () {
    const releases: GitHubRelease[] = [];
    for (const item of items) {
      const candidate = githubReleaseCandidateSchema.safeParse(item);
      if (!candidate.success) {
        return yield* Effect.fail(invalidReleaseObject(candidate.error));
      }
      const release = yield* readRelease(candidate.data);
      const version = valid(release.tagName);
      if (version) {
        releases.push({ ...release, version });
      }
    }
    return releases;
  });

const fetchReleaseJson = (
  fetch: typeof globalThis.fetch,
  url: string,
  description: string,
): Effect.Effect<{ response: Response; value: unknown }, ElectronOperationErrorAggregate> => {
  const controller = new AbortController();
  return Effect.tryPromise({
    try: async () => {
      const timeout = setTimeout(() => {
        controller.abort();
      }, GITHUB_RELEASE_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: apiHeaders,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ElectronOperationError({
            operation: "electron.update.fetch-github-release",
            message: `${description} returned HTTP ${response.status}.`,
            details: { status: response.status, url },
          });
        }
        const value: unknown = await response.json();
        return { response, value };
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: (cause) => {
      if (cause instanceof ElectronOperationError) {
        return cause;
      }
      return new ElectronOperationError({
        operation: "electron.update.fetch-github-release",
        message: controller.signal.aborted ? `${description} timed out.` : errorMessage(cause),
        cause,
        details: { url },
      });
    },
  });
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

const resolvePrerelease = (
  fetch: typeof globalThis.fetch,
  releasesUrl: string,
  channel: string,
): Effect.Effect<
  GitHubRelease,
  ElectronOperationErrorAggregate | ElectronValidationErrorAggregate
> =>
  Effect.gen(function* () {
    let page = 1;
    let selected: GitHubRelease | undefined;

    while (true) {
      const { response, value } = yield* fetchReleaseJson(
        fetch,
        `${releasesUrl}?per_page=100&page=${page}`,
        "GitHub releases request",
      );
      const parsedPage = githubReleasePageSchema.safeParse(value);
      if (!parsedPage.success) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.update.parse-github-releases",
            message: "GitHub releases response is not an array.",
            field: "releases",
            cause: parsedPage.error,
          }),
        );
      }
      const releases = yield* parseReleasePage(parsedPage.data);
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
      return yield* Effect.fail(
        new ElectronOperationError({
          operation: "electron.update.resolve-github-prerelease",
          message: `GitHub has no ${channel} OpenDucktor release.`,
          details: { channel },
        }),
      );
    }
    return selected;
  });

export const compareReleaseVersions = (left: string, right: string): number => {
  if (!valid(left) || !valid(right)) {
    throw new ElectronValidationError({
      operation: "electron.update.compare-release-versions",
      message: `Cannot compare invalid release versions ${left} and ${right}.`,
      field: "version",
      details: { left, right },
    });
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
    resolve: (channel) =>
      runElectronEffect(
        channel !== null
          ? resolvePrerelease(fetch, releasesUrl, channel)
          : Effect.gen(function* () {
              const { value } = yield* fetchReleaseJson(
                fetch,
                `${releasesUrl}/latest`,
                "Latest GitHub release request",
              );
              const candidate = githubReleaseCandidateSchema.safeParse(value);
              if (!candidate.success) {
                return yield* Effect.fail(invalidReleaseObject(candidate.error));
              }
              const release = yield* parseRelease(candidate.data);
              if (release.prerelease) {
                return yield* Effect.fail(
                  new ElectronValidationError({
                    operation: "electron.update.validate-latest-github-release",
                    message: `GitHub latest release ${release.tagName} is unexpectedly a prerelease.`,
                    field: "prerelease",
                    details: { tagName: release.tagName },
                  }),
                );
              }
              return release;
            }),
      ),
  };
};
