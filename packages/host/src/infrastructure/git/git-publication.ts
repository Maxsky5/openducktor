import { createHmac, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Effect, Equal, Cause } from "effect";
import { HostValidationError, HostOperationError } from "../../effect/host-errors";
import type { BoundGitPublication, GitPublicationProgress } from "../../ports/git-port";
import { GitPublicationError } from "../../ports/git-publication-error";
import { runGit, type GitCommandRunner } from "./git-command-runner";

const endpointIdentityKey = randomBytes(32);
const safeEndpoint = (repoPath: string, url: string) => {
  let label: string;
  const helper = /^([a-z0-9_-]+)::(.+)$/i.exec(url);
  if (helper) {
    const address = helper[2]!;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address))
      throw new Error(
        "The Git helper destination has no safe publication label. Use a URL destination before publishing.",
      );
    label = `${helper[1]}::${safeEndpoint(repoPath, address).label}`;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    label = parsed.toString();
  } else if (/^(?:[^/@:]+@)?[^/:]+:.+/.test(url) && !/^[a-z]:[\\/]/i.test(url))
    label = url.replace(/^[^/@]+@/, "").split(/[?#]/)[0]!;
  else label = path.resolve(repoPath, url);
  return {
    identity: createHmac("sha256", endpointIdentityKey).update(url).digest("hex"),
    label,
    url,
  };
};

export const readPublicationTarget = (
  runner: GitCommandRunner,
  input: { repoPath: string; sourceRef: string; remote: string; targetRef: string },
) =>
  Effect.gen(function* () {
    if (
      !input.sourceRef.startsWith("refs/heads/") ||
      !input.targetRef.startsWith("refs/heads/") ||
      !input.remote.trim() ||
      input.remote.startsWith("-")
    )
      return yield* new HostValidationError({
        field: "publication",
        message: "Review the source branch, full target ref, and named publish remote.",
      });
    yield* runGit(runner, input.repoPath, ["check-ref-format", input.sourceRef]);
    yield* runGit(runner, input.repoPath, ["check-ref-format", input.targetRef]);
    const sourceOid = (yield* runGit(runner, input.repoPath, [
      "rev-parse",
      "--verify",
      `${input.sourceRef}^{commit}`,
    ])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(sourceOid))
      return yield* new HostValidationError({
        field: "sourceOid",
        message: "Git returned no valid source commit. Refresh approval context.",
      });
    const urls = (yield* runGit(runner, input.repoPath, [
      "remote",
      "get-url",
      "--push",
      "--all",
      input.remote,
    ]))
      .split(/\r?\n/)
      .filter(Boolean);
    if (!urls.length)
      return yield* new HostValidationError({
        field: "remote",
        message: "The recorded remote has no push destination. Review its Git configuration.",
      });
    const endpoints = yield* Effect.try({
      try: () => urls.map((url) => safeEndpoint(input.repoPath, url)),
      catch: () =>
        new HostValidationError({
          field: "remote",
          message: "The remote has an invalid push URL. Review its Git configuration.",
        }),
    });
    if (new Set(endpoints.map((endpoint) => endpoint.identity)).size !== endpoints.length)
      return yield* new HostValidationError({
        field: "remote",
        message:
          "The remote repeats a push destination. Remove the duplicate URL before publishing.",
      });
    return { ...input, sourceOid, endpoints };
  }).pipe(
    Effect.mapError(
      (error) =>
        new HostOperationError({
          operation: "git.publication.prepare",
          message:
            error instanceof HostValidationError
              ? error.message
              : "Cannot resolve the recorded publication target. Check the local source branch and named remote, then refresh approval context.",
        }),
    ),
  );

/** One normal URL rewrite reaches the already resolved endpoint. Explicit pushurl disables pushInsteadOf. */
const endpointCommand = (endpoint: BoundGitPublication["endpoints"][number]) => {
  const remote = `odt-publication-${randomUUID()}`;
  const alias = `odt-publication:${randomUUID()}`;
  return {
    remote,
    args: [
      "-c",
      `url.${endpoint.url}.insteadOf=${alias}`,
      "-c",
      `remote.${remote}.url=${alias}`,
      "-c",
      `remote.${remote}.pushurl=${alias}`,
    ],
  };
};

export const inspectPublication = (runner: GitCommandRunner, target: BoundGitPublication) =>
  Effect.forEach(target.endpoints, (endpoint) =>
    Effect.gen(function* () {
      const command = endpointCommand(endpoint);
      const output = yield* runGit(runner, target.repoPath, [
        ...command.args,
        "ls-remote",
        "--refs",
        "--",
        command.remote,
        target.targetRef,
      ]);
      const exact = output
        .split(/\r?\n/)
        .map((line) => line.split(/\s+/))
        .filter((row) => row[1] === target.targetRef);
      if (exact.length > 1 || (exact[0] && !/^[a-f0-9]{40,64}$/.test(exact[0][0]!)))
        return yield* new HostValidationError({
          field: "publication",
          message:
            "The destination returned an invalid branch observation. Inspect its exact target ref before continuing.",
        });
      return { destinationIdentity: endpoint.identity, oid: exact[0]?.[0] ?? null };
    }).pipe(
      Effect.mapError(
        () =>
          new HostOperationError({
            operation: "git.publication.inspect",
            message: `Cannot inspect publication destination ${endpoint.label}. Check access to the recorded target ref before continuing.`,
          }),
      ),
    ),
  );

export const pushBoundPublication = (
  runner: GitCommandRunner,
  workingDirectory: string,
  options: { target: BoundGitPublication; destinationIdentities: string[] },
) => {
  const target = options.target;
  const progress: GitPublicationProgress = {
    sourceOid: target.sourceOid,
    targetRef: target.targetRef,
    destinations: target.endpoints.map((endpoint) => ({
      identity: endpoint.identity,
      outcome: "not_issued",
    })),
  };
  const fail = (message: string) => new GitPublicationError(message, structuredClone(progress));
  const work = Effect.gen(function* () {
    if (
      workingDirectory !== target.repoPath ||
      new Set(options.destinationIdentities).size !== options.destinationIdentities.length ||
      options.destinationIdentities.some(
        (identity) => !target.endpoints.some((endpoint) => endpoint.identity === identity),
      )
    )
      return yield* fail(
        "The publication request does not match its bound repository or destination set. Refresh approval context.",
      );
    const verifyTarget = Effect.gen(function* () {
      const current = yield* readPublicationTarget(runner, target);
      if (!Equal.equals(current, target))
        return yield* fail(
          "The source commit or publish destinations changed. Refresh approval context and review publication again.",
        );
    });
    if (!options.destinationIdentities.length) yield* verifyTarget;
    for (const identity of options.destinationIdentities) {
      yield* verifyTarget;
      const endpoint = target.endpoints.find((endpoint) => endpoint.identity === identity)!;
      const destination = progress.destinations.find((value) => value.identity === identity)!;
      const command = endpointCommand(endpoint);
      const result = yield* runner(
        workingDirectory,
        [
          ...command.args,
          "-c",
          "push.followTags=false",
          "-c",
          "push.recurseSubmodules=no",
          "push",
          "--porcelain",
          "--no-follow-tags",
          "--recurse-submodules=no",
          "--",
          command.remote,
          `${target.sourceOid}:${target.targetRef}`,
        ],
        {
          allowFailure: true,
          onStarted: () => {
            destination.outcome = "uncertain";
          },
        },
      );
      const rows = result.stdout
        .split(/\r?\n/)
        .map((line) => line.split("\t"))
        .filter((row) => row[1]?.split(":")[1] === target.targetRef);
      const row = rows.length === 1 ? rows[0] : undefined;
      if (row && [" ", "=", "*"].includes(row[0]!) && result.ok) destination.outcome = "confirmed";
      else if (row?.[0] === "!" && /\[(?:rejected|remote rejected)\]/.test(row[2] ?? ""))
        destination.outcome = "refused";
      else if (destination.outcome !== "not_issued" || result.ok) destination.outcome = "uncertain";
      if (destination.outcome !== "confirmed")
        return yield* fail(
          destination.outcome === "refused"
            ? "The destination refused publication. Inspect the target branch before trying the remaining work."
            : "Publication has no conclusive result. Inspect every recorded destination. Do not push again while acceptance is uncertain.",
        );
    }
    yield* runGit(runner, workingDirectory, [
      "update-ref",
      `refs/remotes/${target.remote}/${target.targetRef.slice("refs/heads/".length)}`,
      target.sourceOid,
    ]);
    return structuredClone(progress);
  });
  return Effect.uninterruptibleMask((restore) =>
    restore(work).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return Effect.fail(
          error instanceof GitPublicationError
            ? error
            : fail(
                !options.destinationIdentities.length ||
                  progress.destinations.every((destination) => destination.outcome === "confirmed")
                  ? "Publication succeeded, but its later tracking update failed. Reconcile the recorded destinations before completing cleanup."
                  : "Publication stopped. Reconcile the recorded destination results before continuing.",
              ),
        );
      }),
    ),
  );
};
