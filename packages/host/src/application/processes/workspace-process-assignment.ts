import type { WorkspaceProcessIssue } from "@openducktor/contracts";
import { Effect } from "effect";
import type { CanonicalPathPlatform } from "@openducktor/path-support";
import type { HostError } from "../../effect/host-errors";
import type { LiveProcess, ProcessInspectorPort } from "../../ports/process-inspector-port";
import type { GitEntryWalk } from "./git-entry-walk";
import { parentDirectory, pathKey } from "./process-path-keys";
import {
  type CheckoutCoverage,
  type CoveredCheckout,
  findCheckoutRoot,
} from "./workspace-process-checkouts";
import { type ExclusionDependencies, readExclusions } from "./workspace-process-exclusions";
import { encodeProcessRef, isIdleInteractiveShell } from "./workspace-process-rules";

export type AssignmentDependencies = ExclusionDependencies & {
  inspector: Pick<ProcessInspectorPort, "listProcesses">;
  pathPlatform: CanonicalPathPlatform;
  /**
   * The executables or scripts of host infrastructure that runtimes start, such as the OpenDucktor
   * MCP server. A process with one of them, and its descendants, never shows.
   */
  hostLaunchPaths: Effect.Effect<readonly string[], HostError>;
};

const UNKNOWN_LAUNCH_PATHS: WorkspaceProcessIssue = {
  message:
    "OpenDucktor cannot identify the MCP servers of its agents now, so it does not stop any process.",
  nextAction: "Check the runtime settings, then refresh.",
};

/** A process and the evidence that ties it to its checkout. */
export type AssignedProcess = {
  process: LiveProcess;
  checkout: CoveredCheckout;
  evidence: { kind: "cwd" | "executable"; path: string };
  /** Why the process never stops, when the host cannot resolve its owner. */
  stopBlocked?: WorkspaceProcessIssue;
};

type Placement =
  | { kind: "checkout"; checkout: CoveredCheckout }
  | { kind: "outside" }
  | { kind: "unknown" };

type Assignment =
  | { kind: "assigned"; entry: AssignedProcess }
  | { kind: "none" }
  | { kind: "unverified" };

/** Ties live processes to the covered checkouts of one read. */
export const createProcessAssigner = (dependencies: AssignmentDependencies) => {
  const keyOf = (path: string) => pathKey(path, dependencies.pathPlatform);
  const executableDirectoryOf = (process: LiveProcess) =>
    process.executable ? parentDirectory(process.executable, dependencies.pathPlatform) : null;

  /**
   * The covered checkout of a directory. A `.git` entry starts a checkout, like the search of Git
   * for the checkout root, so a nested repository or an unattached worktree is never part of the
   * checkout around it. `unknown` means the file system could not answer.
   */
  const placeDirectory = (
    directory: string,
    coverage: CheckoutCoverage,
    walk: GitEntryWalk,
  ): Effect.Effect<Placement> =>
    Effect.gen(function* () {
      const key = keyOf(directory);
      const root = findCheckoutRoot(coverage, key);
      // A root without a checkout is a boundary, and a checkout below it is never covered.
      if (!root?.checkout) return { kind: "outside" };
      if (root.key === key) return { kind: "checkout", checkout: root.checkout };
      const nested = yield* walk(directory, root.key);
      if (nested === "unknown") return { kind: "unknown" };
      return nested ? { kind: "outside" } : { kind: "checkout", checkout: root.checkout };
    });

  /**
   * Ties a process to a covered checkout by the Git root of its working directory. Only a
   * process whose working directory is outside every Git checkout can count by its executable.
   */
  const assign = (
    process: LiveProcess,
    coverage: CheckoutCoverage,
    walk: GitEntryWalk,
  ): Effect.Effect<Assignment> =>
    Effect.gen(function* () {
      const executableDirectory = executableDirectoryOf(process);
      const executableRoot =
        executableDirectory === null
          ? null
          : findCheckoutRoot(coverage, keyOf(executableDirectory));
      // A process whose directory is unreadable is unverified when its executable is covered.
      if (!process.cwd) return executableRoot?.checkout ? { kind: "unverified" } : { kind: "none" };
      const byCwd = yield* placeDirectory(process.cwd, coverage, walk);
      if (byCwd.kind === "checkout")
        return {
          kind: "assigned",
          entry: {
            process,
            checkout: byCwd.checkout,
            evidence: { kind: "cwd", path: process.cwd },
          },
        };
      if (byCwd.kind === "unknown") return { kind: "unverified" };
      if (!process.executable || executableDirectory === null || !executableRoot)
        return { kind: "none" };
      const byExecutable = yield* placeDirectory(executableDirectory, coverage, walk);
      if (byExecutable.kind === "unknown") return { kind: "unverified" };
      if (byExecutable.kind !== "checkout") return { kind: "none" };
      // Only a process whose working directory is outside every Git checkout counts here.
      const insideGit = yield* walk(process.cwd, null);
      if (insideGit === "unknown") return { kind: "unverified" };
      if (insideGit) return { kind: "none" };
      return {
        kind: "assigned",
        entry: {
          process,
          checkout: byExecutable.checkout,
          evidence: { kind: "executable", path: process.executable },
        },
      };
    });

  /** True when a listed root holds the working directory or the executable of the process. */
  const nearCheckout = (process: LiveProcess, coverage: CheckoutCoverage) => {
    const executableDirectory = executableDirectoryOf(process);
    return (
      (process.cwd !== undefined && findCheckoutRoot(coverage, keyOf(process.cwd)) !== null) ||
      (executableDirectory !== null &&
        findCheckoutRoot(coverage, keyOf(executableDirectory)) !== null)
    );
  };

  /** Lists the processes of the covered checkouts and the candidates that the host cannot verify. */
  const readAssignedProcesses = (coverage: CheckoutCoverage, walk: GitEntryWalk) =>
    Effect.gen(function* () {
      const [processes, launchPaths] = yield* Effect.all(
        [dependencies.inspector.listProcesses(), dependencies.hostLaunchPaths.pipe(Effect.result)],
        { concurrency: 2 },
      );
      const { excluded, stopBlocked, runtimes } = yield* readExclusions(
        dependencies,
        processes,
        launchPaths._tag === "Success" ? launchPaths.success : [],
      );
      // Most processes of the machine run far from every checkout, so a key match drops them
      // before any file read.
      const eligible = processes.filter(
        (process) =>
          !excluded.has(process.pid) &&
          nearCheckout(process, coverage) &&
          !isIdleInteractiveShell(process),
      );
      const assignments = yield* Effect.forEach(
        eligible,
        (process) => assign(process, coverage, walk),
        { concurrency: 8 },
      );
      // Without the launch paths, an MCP server of an agent can look like a project command.
      const blockedBy = (pid: number) =>
        launchPaths._tag === "Failure" ? UNKNOWN_LAUNCH_PATHS : stopBlocked.get(pid);
      const assigned: AssignedProcess[] = [];
      const unverified = new Set<string>();
      assignments.forEach((assignment, index) => {
        const process = eligible[index];
        if (assignment.kind === "assigned") {
          const blocked = blockedBy(assignment.entry.process.pid);
          assigned.push(
            blocked === undefined
              ? assignment.entry
              : { ...assignment.entry, stopBlocked: blocked },
          );
        } else if (assignment.kind === "unverified" && process)
          unverified.add(encodeProcessRef(process));
      });
      const issues: WorkspaceProcessIssue[] = [];
      if (unverified.size > 0)
        issues.push({
          message: `OpenDucktor cannot verify the checkout of ${unverified.size === 1 ? "1 process" : `${unverified.size} processes`}, so the list hides ${unverified.size === 1 ? "it" : "them"}.`,
          nextAction:
            "Check that Git can read the checkouts and that this account can read the processes, then refresh.",
        });
      if (launchPaths._tag === "Failure")
        issues.push({
          message: `OpenDucktor cannot identify the MCP servers of its agents, so Stop is off in this list. ${launchPaths.failure.message}`,
          nextAction: "Check the runtime settings, then refresh.",
        });
      return { processes, assigned, unverified, issues, runtimes };
    });

  return { readAssignedProcesses };
};
