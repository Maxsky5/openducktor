// The data of the Processes view of packages/frontend/src/components/features/processes: the
// checkouts with the commands that run in them, as processes-view.ts gives them to the list, and
// the words of the view. src/copied-processes.test.ts compares the words with the app.

/** One command of a checkout, on one line: its folder, its title, its ports, and Stop. */
export type ProcessCommand = {
  /** The name that the scenes use to find the line. */
  id: string;
  /** The folder of the command below the checkout. It is empty at the root of the checkout. */
  directory: string;
  /** The command as commandTitle of processes-view.ts gives it. */
  command: string;
  /** The ports of the processes of the command, by port number. */
  ports: readonly number[];
  /** The PID of the first process. */
  pid: number;
  /** The processes of the command: the first process and each process that it started. */
  processes: number;
};

/**
 * One checkout: a task worktree with its task title and ID, or the repository checkout of a
 * workspace with the workspace name.
 */
export type ProcessGroup = {
  /** The name that the scenes use to find the checkout. */
  id: string;
  kind: "repository" | "worktree";
  /** groupTitle of processes-labels.ts. */
  title: string;
  /** The task IDs of a worktree: groupSubtitle of processes-labels.ts. */
  subtitle?: string;
  /**
   * The checkout of the task of the session page: the list shows it first, with the This task
   * badge. Another page has no task, so no checkout has the badge.
   */
  focused: boolean;
  commands: readonly ProcessCommand[];
};

/** FLOATING_MIN_SIZE of processes-surfaces.tsx: the smallest size of the floating window. */
export const FLOATING_MIN_SIZE = { width: 400, height: 280 } as const;

/** The words of the view, from processes-surfaces.tsx, processes-panel.tsx, and their rows. */
export const PROCESSES_LABELS = {
  title: "Processes",
  /** The title of the rail button while no command runs. */
  railTip: "Running processes and ports",
  filter: "Search commands",
  detach: "Detach into a floating window",
  attach: "Attach to the rail",
  focused: "This task",
  stopping: "Stopping…",
  stop: "Stop",
} as const;

/** countLabel of processes-labels.ts. */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The counts of the toolbar of the list: ProcessSummary of processes-panel.tsx. */
export function processSummary(groups: readonly ProcessGroup[]): string {
  const commands = groups.flatMap((group) => group.commands);
  const ports = commands.reduce((total, command) => total + command.ports.length, 0);
  const text = countLabel(commands.length, "command", "commands");
  return ports > 0 ? `${text} · ${countLabel(ports, "port", "ports")}` : text;
}

/**
 * The facts of the stop confirmation of process-stop-popover.tsx: the folder, the PID of a
 * command of one process or the process count, and the local ports. Paths and ports are code.
 */
export function stopFacts(command: ProcessCommand): { text: string; code: boolean }[] {
  return [
    ...(command.directory ? [{ text: command.directory, code: true }] : []),
    {
      text:
        command.processes === 1
          ? `PID ${command.pid}`
          : countLabel(command.processes, "process", "processes"),
      code: false,
    },
    ...command.ports.map((port) => ({ text: `:${port}`, code: true })),
  ];
}
