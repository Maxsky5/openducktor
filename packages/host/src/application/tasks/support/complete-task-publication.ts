import type { DirectMergeRecord, TaskDirectMergeCompleteIntent } from "@openducktor/contracts";
import { Effect, Equal } from "effect";
import { checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { GitPort, GitPublicationProgress } from "../../../ports/git-port";
import { GitPublicationError } from "../../../ports/git-publication-error";
import type { TaskCompletionState } from "../task-completion-state";

export const completeTaskPublication = (
  git: GitPort,
  input: TaskDirectMergeCompleteIntent,
  merge: DirectMergeRecord,
  state: TaskCompletionState,
) =>
  Effect.gen(function* () {
    const remote = merge.targetBranch.remote;
    const branch = checkoutBranch(merge.targetBranch);
    const currentBranch = yield* git.getCurrentBranch(input.repoPath);
    if (currentBranch.detached || currentBranch.name !== branch)
      return yield* invalid(
        `Check out the recorded target branch ${branch} before completing this merge.`,
      );
    const verifyMerge = (sourceOid: string) =>
      git
        .isMergeIncluded(input.repoPath, merge.sourceBranch, sourceOid, state.appliedTargetOid)
        .pipe(
          Effect.flatMap((included) =>
            included
              ? Effect.void
              : invalid(
                  "Git cannot confirm that the current target retains the recorded merge content. Inspect its original Git evidence and the current target before completing. Do not replay the merge or publication.",
                ),
          ),
        );
    if (!remote) {
      if (input.publicationConsent)
        return yield* invalid(
          "The recorded merge has no publication destination. Refresh approval context.",
        );
      if (!currentBranch.revision)
        return yield* invalid(
          "The target commit is unavailable. Restore and inspect its Git state before completing this merge.",
        );
      yield* verifyMerge(currentBranch.revision);
      return;
    }
    const current = yield* git.readPublicationTarget({
      repoPath: input.repoPath,
      sourceRef: `refs/heads/${branch}`,
      remote,
      targetRef: `refs/heads/${branch}`,
    });
    const preview = {
      sourceOid: current.sourceOid,
      remote: current.remote,
      targetRef: current.targetRef,
      destinations: current.endpoints.map(({ identity, label }) => ({ identity, label })),
    };
    if (
      input.publicationConsent &&
      (!Equal.equals(merge, input.publicationConsent.expectedMerge) ||
        !Equal.equals(preview, input.publicationConsent.expectedPublication))
    )
      return yield* invalid(
        "The applied merge, source commit, or publication destination changed. Refresh approval context and review publication again.",
      );
    if (state.publication && !Equal.equals(state.publication, current))
      return yield* invalid(
        "The recorded publication attempt no longer matches the current branch or destinations. Inspect its original results before continuing. Do not push again.",
      );
    yield* verifyMerge(current.sourceOid);
    const target = state.publication ?? current;
    const observed = yield* git.inspectPublication(target);
    const prior = state.progress ?? {
      sourceOid: target.sourceOid,
      targetRef: target.targetRef,
      destinations: target.endpoints.map((endpoint) => ({
        identity: endpoint.identity,
        outcome: "not_issued" as const,
      })),
    };
    for (const destination of prior.destinations) {
      const observation = observed.find(
        (value) => value.destinationIdentity === destination.identity,
      );
      if (!observation)
        return yield* invalid(
          "The runtime omitted a publication destination observation. Inspect every recorded target before continuing.",
        );
      if (observation.oid === target.sourceOid) destination.outcome = "confirmed";
      else if (destination.outcome === "uncertain" || destination.outcome === "confirmed")
        return yield* invalid(
          "A recorded destination does not confirm the original publication. Its current ref cannot prove refusal. Do not push again while acceptance remains unresolved.",
        );
    }
    state.publication = target;
    state.progress = prior;
    const remaining = prior.destinations
      .filter((destination) => destination.outcome !== "confirmed")
      .map((destination) => destination.identity);
    if (!remaining.length) {
      yield* git.pushBoundPublication(input.repoPath, { target, destinationIdentities: [] });
      return;
    }
    if (!input.publicationConsent)
      return yield* invalid(
        "Publication is required. Review the recorded destinations and explicitly choose Publish and complete.",
      );
    const mergeProgress = (next: GitPublicationProgress) => {
      state.progress = {
        ...next,
        destinations: prior.destinations.map((destination) =>
          remaining.includes(destination.identity)
            ? (next.destinations.find((value) => value.identity === destination.identity) ??
              destination)
            : destination,
        ),
      };
    };
    const result = yield* Effect.result(
      git.pushBoundPublication(input.repoPath, { target, destinationIdentities: remaining }),
    );
    if (result._tag === "Failure") {
      if (result.failure instanceof GitPublicationError) mergeProgress(result.failure.publication);
      return yield* Effect.fail(result.failure);
    }
    mergeProgress(result.success);
    const confirmed = yield* git.inspectPublication(target);
    if (
      confirmed.length !== target.endpoints.length ||
      confirmed.some((value) => value.oid !== target.sourceOid)
    )
      return yield* invalid(
        "Publication returned, but synchronization is not confirmed at every destination. Inspect the original target before continuing. Do not repeat confirmed publication.",
      );
  });
const invalid = (message: string) =>
  new HostValidationError({ field: "publicationConsent", message });
