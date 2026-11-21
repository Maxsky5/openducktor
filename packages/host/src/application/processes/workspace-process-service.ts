import type {
  WorkspaceProcessGroup,
  WorkspaceProcessIssue,
  WorkspaceProcessList,
  WorkspaceProcessRow,
  WorkspaceProcessStopRequest,
  WorkspaceProcessStopResponse,
  WorkspaceProcessStopResult,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type {
  InspectedProcess,
  LiveProcess,
  ProcessInspectorError,
  ProcessInspectorPort,
  ProcessInstance,
} from "../../ports/process-inspector-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-model";
import {
  type CoveredCheckout,
  type ProcessCheckoutDependencies,
  createProcessRead,
  readCheckoutCoverage,
  type RootsReuse,
} from "./workspace-process-checkouts";
import {
  appName,
  browserTarget,
  decodeProcessRef,
  encodeProcessRef,
  processCommandLine,
  processDisplayName,
  runsAgentCommand,
} from "./workspace-process-rules";
import { keyContains, pathKey } from "./process-path-keys";
import {
  type AssignedProcess,
  type AssignmentDependencies,
  createProcessAssigner,
} from "./workspace-process-assignment";
import { parentOf } from "./workspace-process-exclusions";

type WorkspaceProcessServiceError =
  | HostError
  | TaskStoreError
  | WorkspaceSettingsError
  | ProcessInspectorError;

export type WorkspaceProcessDependencies = ProcessCheckoutDependencies &
  AssignmentDependencies & {
    inspector: ProcessInspectorPort;
    workspaceSettings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
    /** True when a stop ends the process at once, as `TerminateProcess` does on Windows. */
    stopForcesExit: boolean;
    stopTimeoutMs?: number;
  };

export type WorkspaceProcessService = {
  /** Lists the processes of the checkouts of all open workspaces. */
  list(): Effect.Effect<WorkspaceProcessList, WorkspaceProcessServiceError>;
  stop(
    request: WorkspaceProcessStopRequest,
  ): Effect.Effect<WorkspaceProcessStopResponse, WorkspaceProcessServiceError>;
};

const REFRESH: WorkspaceProcessIssue["nextAction"] = "Refresh the list.";
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
/**
 * A list read reuses the Git roots of a workspace for this long. The view reads every 2 seconds
 * while open and every 5 seconds while closed, so most reads start no Git process. A stop always
 * reads the roots again.
 */
const ROOTS_REUSE_MS = 30_000;

const outOfDate = (message: string, nextAction = REFRESH): WorkspaceProcessStopResult => ({
  kind: "out_of_date",
  issue: { message, nextAction },
});

const ALREADY_PENDING: WorkspaceProcessStopResult = {
  kind: "pending",
  issue: {
    message: "A stop request for this process is already running.",
    nextAction: "Wait for the current stop request to finish.",
  },
};

/** The result of the check that runs again before a stop. */
type StopVerification =
  | { kind: "verified"; entry: AssignedProcess }
  | { kind: "refused"; result: WorkspaceProcessStopResult };

const refused = (result: WorkspaceProcessStopResult): StopVerification => ({
  kind: "refused",
  result,
});

const acknowledgmentRequired = () =>
  outOfDate(
    "This system can only stop the process by its ID, which needs your confirmation.",
    "Refresh the list, then confirm the stop again.",
  );

const sameInstance = (left: ProcessInstance, right: ProcessInstance) =>
  left.pid === right.pid && left.identity === right.identity;

export const createWorkspaceProcessService = (
  dependencies: WorkspaceProcessDependencies,
): WorkspaceProcessService => {
  const pendingStops = new Set<string>();
  // Each read gets its own Git read context and caches, so one refresh reads each thing once.
  let reads = 0;
  const rootsReuse: RootsReuse = { cache: new Map(), maxAgeMs: ROOTS_REUSE_MS, now: Date.now };
  const nextRead = (reuse?: RootsReuse) =>
    createProcessRead(dependencies, `processes-${(reads += 1)}`, reuse);
  const stopTimeoutMs = dependencies.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const keyOf = (path: string) => pathKey(path, dependencies.pathPlatform);
  const { readAssignedProcesses } = createProcessAssigner(dependencies);

  const stopAvailability = (
    entry: AssignedProcess,
    inspection: InspectedProcess,
    stopMode: "instance" | "pid",
  ): WorkspaceProcessRow["stop"] => {
    if (entry.stopBlocked !== undefined) return { allowed: false, issue: entry.stopBlocked };
    if (!inspection.canStop)
      return {
        allowed: false,
        issue: {
          message: "The host account cannot stop this process.",
          nextAction: "Stop it from the account that started it.",
        },
      };
    return {
      allowed: true,
      requiresPidReuseAcknowledgment: stopMode === "pid",
      forced: dependencies.stopForcesExit,
    };
  };

  const toRow = (
    entry: AssignedProcess,
    inspection: InspectedProcess,
    stopMode: "instance" | "pid",
  ): WorkspaceProcessRow => {
    const listeners = [...(inspection.listeners ?? [])]
      .sort(
        (left, right) =>
          left.port - right.port ||
          Number(left.address.includes(":")) - Number(right.address.includes(":")) ||
          (left.address < right.address ? -1 : Number(left.address > right.address)),
      )
      .map((listener) => ({
        address: listener.address,
        port: listener.port,
        browser: browserTarget(entry.process, listener),
      }));
    const row: WorkspaceProcessRow = {
      processRef: encodeProcessRef(entry.process),
      pid: entry.process.pid,
      name: processDisplayName(entry.process),
      command: processCommandLine(entry.process),
      stop: stopAvailability(entry, inspection, stopMode),
      listeners,
    };
    if (entry.evidence.kind === "cwd") row.directory = relativeDirectory(entry);
    if (inspection.listenerIssue)
      row.listenerIssue = {
        message: `Some ports of this process are unknown. ${inspection.listenerIssue}`,
        nextAction: REFRESH,
      };
    return row;
  };

  /** The working directory below the checkout root, with `/` separators. */
  const relativeDirectory = (entry: AssignedProcess): string => {
    const key = keyOf(entry.evidence.path);
    const root = entry.checkout.key;
    if (key === root || !keyContains(root, key)) return "";
    return key.slice(root.endsWith("/") ? root.length : root.length + 1);
  };

  /**
   * Links each row to the nearest shown process of its checkout that started it. A row without
   * one names the app that started it, unless a shell or an agent runtime did, or the row is a
   * shell itself.
   */
  const linkParents = (
    assigned: readonly AssignedProcess[],
    processes: readonly LiveProcess[],
    rows: ReadonlyMap<string, { row: WorkspaceProcessRow; checkout: CoveredCheckout }>,
    runtimes: ReadonlySet<number>,
  ) => {
    const byPid = new Map(processes.map((process) => [process.pid, process]));
    for (const entry of assigned) {
      const shown = rows.get(encodeProcessRef(entry.process));
      if (!shown) continue;
      const visited = new Set<number>();
      for (
        let parent = parentOf(byPid, entry.process);
        parent && !visited.has(parent.pid);
        parent = parentOf(byPid, parent)
      ) {
        visited.add(parent.pid);
        const parentRef = encodeProcessRef(parent);
        if (rows.get(parentRef)?.checkout !== entry.checkout) continue;
        shown.row.parentRef = parentRef;
        break;
      }
      if (shown.row.parentRef !== undefined || runsAgentCommand(entry.process)) continue;
      // A process whose parent exited belongs to init, as a command of a closed terminal does.
      const parent = parentOf(byPid, entry.process);
      if (parent && parent.pid !== 1 && !runsAgentCommand(parent) && !runtimes.has(parent.pid))
        shown.row.launcher = appName(parent);
    }
  };

  const buildGroups = (
    checkouts: readonly CoveredCheckout[],
    assigned: readonly AssignedProcess[],
    processes: readonly LiveProcess[],
    runtimes: ReadonlySet<number>,
  ) =>
    Effect.gen(function* () {
      const inspections =
        assigned.length === 0
          ? []
          : yield* dependencies.inspector.inspectProcesses(
              assigned.map(({ process }) => ({ pid: process.pid, identity: process.identity })),
            );
      const stopMode = yield* dependencies.inspector.stopMode();
      const rows = new Map<CoveredCheckout, WorkspaceProcessRow[]>();
      const byRef = new Map<string, { row: WorkspaceProcessRow; checkout: CoveredCheckout }>();
      assigned.forEach((entry, index) => {
        const inspection = inspections[index];
        if (!inspection?.live) return;
        const row = toRow(entry, inspection, stopMode);
        const list = rows.get(entry.checkout) ?? [];
        list.push(row);
        rows.set(entry.checkout, list);
        byRef.set(row.processRef, { row, checkout: entry.checkout });
      });
      linkParents(assigned, processes, byRef, runtimes);
      return checkouts.map((checkout): WorkspaceProcessGroup => ({
        workspaceId: checkout.workspaceId,
        workspaceName: checkout.workspaceName,
        checkoutPath: checkout.checkoutPath,
        kind: checkout.kind,
        owners: checkout.owners,
        processes: (rows.get(checkout) ?? []).sort(
          (left, right) =>
            Number(right.listeners.length > 0) - Number(left.listeners.length > 0) ||
            left.name.localeCompare(right.name) ||
            left.pid - right.pid,
        ),
      }));
    });

  const list: WorkspaceProcessService["list"] = () =>
    Effect.gen(function* () {
      const catalog = yield* dependencies.workspaceSettings.getWorkspaceCatalog();
      const read = nextRead(rootsReuse);
      const coverage = yield* readCheckoutCoverage(dependencies, catalog.openWorkspaces, read);
      // Nothing could be read, so the list would only hide the reason.
      if (coverage.checkouts.length === 0 && coverage.issues.length > 0)
        return yield* new HostOperationError({
          operation: "processes.list",
          message: coverage.issues.map((issue) => issue.message).join(" "),
        });
      const { processes, assigned, issues, runtimes } = yield* readAssignedProcesses(
        coverage,
        read.walkGitEntries,
      );
      const groups = yield* buildGroups(coverage.checkouts, assigned, processes, runtimes);
      return { groups, issues: [...coverage.issues, ...issues] };
    });

  /**
   * Reads the processes again with the current links. The returned check tells whether one
   * process may still stop, so one read serves every process of a request.
   */
  const verifyStops = (
    request: WorkspaceProcessStopRequest,
  ): Effect.Effect<(instance: ProcessInstance) => StopVerification, WorkspaceProcessServiceError> =>
    Effect.gen(function* () {
      const catalog = yield* dependencies.workspaceSettings.getWorkspaceCatalog();
      const workspace = catalog.openWorkspaces.find(
        (candidate: WorkspaceRecord) => candidate.workspaceId === request.workspaceId,
      );
      if (!workspace) {
        const result = refused(
          outOfDate(
            "The workspace of this process is not open.",
            "Open the workspace, then refresh.",
          ),
        );
        return () => result;
      }
      const read = nextRead();
      const coverage = yield* readCheckoutCoverage(dependencies, [workspace], read);
      const requestedKey = keyOf(request.checkoutPath);
      const checkout = coverage.checkouts.find((candidate) => candidate.key === requestedKey);
      if (!checkout) {
        const result = refused(
          outOfDate("OpenDucktor cannot verify the checkout of this process."),
        );
        return () => result;
      }
      const { processes, assigned, unverified } = yield* readAssignedProcesses(
        coverage,
        read.walkGitEntries,
      );
      return (instance: ProcessInstance): StopVerification => {
        if (!processes.some((process) => sameInstance(process, instance)))
          return refused({ kind: "already_exited" });
        if (unverified.has(encodeProcessRef(instance)))
          return refused(outOfDate("OpenDucktor cannot verify the checkout of this process."));
        const entry = assigned.find(({ process }) => sameInstance(process, instance));
        if (!entry) return refused(outOfDate("This process no longer runs in this checkout."));
        if (entry.stopBlocked !== undefined)
          return refused(outOfDate(entry.stopBlocked.message, entry.stopBlocked.nextAction));
        if (entry.checkout !== checkout)
          return refused(outOfDate("This process now runs in another checkout."));
        return { kind: "verified", entry };
      };
    });

  const signalStop = (
    request: WorkspaceProcessStopRequest,
    { process, evidence }: AssignedProcess,
  ): Effect.Effect<WorkspaceProcessStopResult, WorkspaceProcessServiceError> =>
    Effect.gen(function* () {
      const outcome = yield* dependencies.inspector.stopProcess({
        pid: process.pid,
        identity: process.identity,
        evidenceKind: evidence.kind,
        evidencePath: evidence.path,
        timeoutMs: stopTimeoutMs,
        // The native module knows the signal mode, so it refuses a PID signal without consent.
        allowPidSignal: request.acknowledgedPidReuseRisk === true,
      });
      const issue = (message: string | undefined, fallback: string): WorkspaceProcessIssue => ({
        message: message ?? fallback,
        nextAction: REFRESH,
      });
      switch (outcome.kind) {
        case "stopped":
          return { kind: "stopped" } satisfies WorkspaceProcessStopResult;
        case "already_exited":
          return { kind: "already_exited" } satisfies WorkspaceProcessStopResult;
        case "changed":
          return outOfDate(outcome.message ?? "The process changed before the stop request.");
        case "acknowledgment_required":
          return acknowledgmentRequired();
        case "denied":
        case "failed":
        case "still_running":
          return {
            kind: "still_running",
            issue: issue(outcome.message, "The process is still running."),
          } satisfies WorkspaceProcessStopResult;
        case "unconfirmed":
          return {
            kind: "unconfirmed",
            issue: issue(outcome.message, "OpenDucktor cannot confirm that the process stopped."),
          } satisfies WorkspaceProcessStopResult;
      }
    });

  /** A stop request for a process, or its result when the request cannot send a signal. */
  type StopClaim =
    | { processRef: string; kind: "claimed"; instance: ProcessInstance }
    | { processRef: string; kind: "done"; result: WorkspaceProcessStopResult };

  /** Stops the processes of a request together, as Ctrl+C stops a command in a terminal. */
  const stop: WorkspaceProcessService["stop"] = (request) =>
    Effect.gen(function* () {
      const claimed: string[] = [];
      const claims = [...new Set(request.processRefs)].map((processRef): StopClaim => {
        const instance = decodeProcessRef(processRef);
        if (!instance)
          return {
            processRef,
            kind: "done",
            result: outOfDate("The process reference is not valid."),
          };
        const key = encodeProcessRef(instance);
        if (pendingStops.has(key)) return { processRef, kind: "done", result: ALREADY_PENDING };
        pendingStops.add(key);
        claimed.push(key);
        return { processRef, kind: "claimed", instance };
      });
      const results = yield* Effect.gen(function* () {
        // Only claimed processes need the read, so a request of pending stops reads nothing.
        const verify = claimed.length === 0 ? () => null : yield* verifyStops(request);
        return yield* Effect.forEach(
          claims,
          (claim) => {
            const { processRef } = claim;
            if (claim.kind === "done") return Effect.succeed({ processRef, result: claim.result });
            const verification = verify(claim.instance);
            if (verification?.kind !== "verified")
              return Effect.succeed({
                processRef,
                result: verification?.result ?? ALREADY_PENDING,
              });
            return signalStop(request, verification.entry).pipe(
              Effect.map((result) => ({ processRef, result })),
            );
          },
          { concurrency: "unbounded" },
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const key of claimed) pendingStops.delete(key);
          }),
        ),
      );
      return { results };
    });

  return { list, stop };
};
