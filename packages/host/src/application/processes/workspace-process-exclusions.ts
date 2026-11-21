import type { WorkspaceProcessIssue } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  LiveProcess,
  ManagedProcess,
  ProcessInspectorPort,
} from "../../ports/process-inspector-port";
import { isAgentRuntimeServer, runsAgentCommand } from "./workspace-process-rules";

export type ExclusionDependencies = {
  inspector: Pick<ProcessInspectorPort, "readStandardInputs">;
  /** The processes of the host and its shell, such as the Electron helpers. */
  hostProcessIds: () => readonly number[];
  managedProcesses: () => ReadonlyMap<number, ManagedProcess>;
};

const LAUNCHED_BY_UNKNOWN_LAUNCHER: WorkspaceProcessIssue = {
  message:
    "A Windows batch launcher that OpenDucktor does not know started the agent runtime here, so OpenDucktor cannot prove which processes belong to the runtime and does not stop this one.",
  nextAction: "Stop the agent session, or stop the process from its terminal.",
};

/**
 * The parent of a process, or undefined when the parent is gone. Windows keeps the parent PID of
 * a process after its parent exits, so another process can get that PID later. An instance
 * identity grows with the start of a process on every platform, so a process that started after
 * the child is not its parent.
 */
export const parentOf = (
  byPid: ReadonlyMap<number, LiveProcess>,
  child: LiveProcess,
): LiveProcess | undefined => {
  const parent = byPid.get(child.parentPid);
  return parent && BigInt(child.identity) >= BigInt(parent.identity) ? parent : undefined;
};

/** The children of each parent PID. */
const childrenByParent = (processes: readonly LiveProcess[]) => {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const children = new Map<number, LiveProcess[]>();
  for (const process of processes) {
    if (byPid.has(process.parentPid) && !parentOf(byPid, process)) continue;
    const siblings = children.get(process.parentPid) ?? [];
    siblings.push(process);
    children.set(process.parentPid, siblings);
  }
  return children;
};

/**
 * The processes that started the given processes, such as the `npm exec` and the shell that
 * started the web host. Stopping one of them stops the host.
 */
const ancestors = (processes: readonly LiveProcess[], pids: Iterable<number>): Set<number> => {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const found = new Set<number>();
  for (const pid of pids) {
    const start = byPid.get(pid);
    for (
      let parent = start && parentOf(byPid, start);
      parent && !found.has(parent.pid);
      parent = parentOf(byPid, parent)
    )
      found.add(parent.pid);
  }
  return found;
};

/** All descendants of the roots. The walk visits each process once. */
const descendants = (
  children: ReadonlyMap<number, readonly LiveProcess[]>,
  roots: readonly number[],
): LiveProcess[] => {
  const found: LiveProcess[] = [];
  const visited = new Set(roots);
  const pending = [...roots];
  for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
    for (const child of children.get(parent) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      found.push(child);
      pending.push(child.pid);
    }
  }
  return found;
};

const UNKNOWN_CHANNEL: WorkspaceProcessIssue = {
  message:
    "OpenDucktor cannot read whether the agent runtime talks to this process as a tool, so it does not stop it.",
  nextAction: "Stop the process from the agent session.",
};

/**
 * The processes that the view never shows, and the shown processes that never stop. Hidden: the
 * host, its shell, and the processes that started them, the agent runtimes with their tools, the
 * launcher levels of a runtime, and host infrastructure with its descendants. The commands that a
 * runtime starts stay visible.
 */
export const readExclusions = (
  dependencies: ExclusionDependencies,
  processes: readonly LiveProcess[],
  hostLaunchPaths: readonly string[],
) =>
  Effect.gen(function* () {
    const children = childrenByParent(processes);
    const hostProcessIds = new Set(dependencies.hostProcessIds());
    const excluded = new Set([...hostProcessIds, ...ancestors(processes, hostProcessIds)]);
    const stopBlocked = new Map<number, WorkspaceProcessIssue>();
    const infrastructure: number[] = [];
    const launchers: number[] = [];
    const runtimes = new Set<number>();
    for (const [pid, managed] of dependencies.managedProcesses()) {
      excluded.add(pid);
      if (managed.kind === "infrastructure") infrastructure.push(pid);
      if (managed.kind === "runtime_launcher") launchers.push(pid);
      if (managed.kind === "runtime") runtimes.add(pid);
    }
    // The runtimes of another OpenDucktor app run commands in these checkouts too.
    for (const process of processes)
      if (isAgentRuntimeServer(process)) {
        runtimes.add(process.pid);
        excluded.add(process.pid);
      }
    // A runtime starts the OpenDucktor MCP server, so only its launch path identifies it.
    for (const process of processes) {
      const launchedByHost = hostLaunchPaths.some(
        (path) => process.executable === path || process.arguments?.includes(path) === true,
      );
      if (launchedByHost) {
        excluded.add(process.pid);
        infrastructure.push(process.pid);
      }
    }
    // A runtime runs a command of the agent through a shell, a sandbox wrapper, or directly, as
    // Codex does. It talks to its tools, such as MCP and language servers, over their standard
    // input, as the stdio transports of both protocols require. The host runs its terminals
    // through a shell, and talks to its other children, such as Git, the same way.
    const toolCandidates = [...hostProcessIds, ...runtimes].flatMap((owner) =>
      (children.get(owner) ?? []).filter(
        (child) => !excluded.has(child.pid) && !runsAgentCommand(child),
      ),
    );
    const launcherCandidates = descendants(children, launchers).filter(
      (process) => !excluded.has(process.pid),
    );
    const targets = new Map(
      [...toolCandidates, ...launcherCandidates].map((process) => [
        process.pid,
        { pid: process.pid, identity: process.identity },
      ]),
    );
    const inputs =
      targets.size === 0
        ? []
        : yield* dependencies.inspector.readStandardInputs([...targets.values()]);
    const inputOf = new Map(inputs.map((input) => [input.pid, input]));
    for (const child of toolCandidates) {
      const input = inputOf.get(child.pid);
      if (!input?.live) continue;
      if (input.kind === "pipe") {
        excluded.add(child.pid);
        infrastructure.push(child.pid);
      } else if (input.issue !== undefined) stopBlocked.set(child.pid, UNKNOWN_CHANNEL);
    }
    for (const process of descendants(children, infrastructure)) excluded.add(process.pid);
    // Each launcher level and the runtime inherit the input pipe that the host serves, so such a
    // process is hidden. A launcher can relay the input in other ways, such as a pipe of its own
    // or a Node IPC channel, so the process graph never proves where the runtime ends. Every other
    // process below a launcher stays visible but never stops.
    for (const process of launcherCandidates) {
      const input = inputOf.get(process.pid);
      if (!input?.live || excluded.has(process.pid)) continue;
      if (input.serverPid !== undefined && hostProcessIds.has(input.serverPid))
        excluded.add(process.pid);
      else stopBlocked.set(process.pid, LAUNCHED_BY_UNKNOWN_LAUNCHER);
    }
    return { excluded, stopBlocked, runtimes };
  });
