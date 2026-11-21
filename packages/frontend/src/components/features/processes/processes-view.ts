import type {
  WorkspaceProcessGroup,
  WorkspaceProcessList,
  WorkspaceProcessListener,
  WorkspaceProcessRow,
} from "@openducktor/contracts";

/**
 * One cell of the tree lines before a process: the line of an open level above, an empty level,
 * or the branch to the process, `last` for the last child of its parent.
 */
export type TreeGuide = "line" | "space" | "branch" | "last";

/**
 * A process of a command, at its depth below the command. `guides` draw the tree lines before
 * it, and `matched` marks a filter match.
 */
export type ProcessMember = {
  row: WorkspaceProcessRow;
  depth: number;
  guides: TreeGuide[];
  matched: boolean;
};

/**
 * One command that a user or an agent started, such as `pnpm dev` in `apps/web`, with the
 * processes that it started. Each process of a checkout belongs to exactly one command.
 */
export type ProcessCommandView = {
  root: WorkspaceProcessRow;
  /** The root first, then each process below its parent. */
  members: ProcessMember[];
  /** The ports of every member, by port number. */
  listeners: WorkspaceProcessListener[];
  /** True when the filter matches only processes below the root, so the details open. */
  matchedBelow: boolean;
};

/**
 * The processes that one app started in a checkout without a shell, such as the language servers
 * of an editor. They fold behind one line, below the commands.
 */
export type ProcessAppView = {
  name: string;
  /** The commands of the app, each root followed by the processes that it started. */
  members: ProcessMember[];
  listeners: WorkspaceProcessListener[];
  matchedBelow: boolean;
};

/** One checkout in the dialog with its commands and the processes of other apps. */
export type ProcessGroupView = {
  group: WorkspaceProcessGroup;
  commands: ProcessCommandView[];
  apps: ProcessAppView[];
};

/** The words of a filter, in lower case. Each word must match, in any order. */
export const filterTerms = (filter: string): string[] =>
  filter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");

/** The text that a filter reads in a row: its name, command, folder, PID, and ports. */
const searchText = (row: WorkspaceProcessRow): string =>
  [
    row.name,
    row.command,
    row.directory ?? "",
    String(row.pid),
    ...row.listeners.map((listener) => `:${listener.port}`),
  ]
    .join("\n")
    .toLowerCase();

/** True when each term is in one of the texts. */
const coversTerms = (texts: readonly string[], terms: readonly string[]): boolean =>
  terms.every((term) => texts.some((text) => text.includes(term)));

/** The commands of a checkout: each process without a listed parent starts one. */
const commandsOf = (rows: readonly WorkspaceProcessRow[]): ProcessCommandView[] => {
  const refs = new Set(rows.map((row) => row.processRef));
  const children = new Map<string, WorkspaceProcessRow[]>();
  for (const row of rows) {
    if (row.parentRef === undefined || !refs.has(row.parentRef)) continue;
    children.set(row.parentRef, [...(children.get(row.parentRef) ?? []), row]);
  }
  const roots = rows.filter((row) => row.parentRef === undefined || !refs.has(row.parentRef));
  return roots.map((root) => {
    const members: ProcessMember[] = [];
    const visited = new Set<string>();
    // `above` holds the cells of the levels above, and `last` ends the line of this level.
    const visit = (
      row: WorkspaceProcessRow,
      depth: number,
      above: readonly TreeGuide[],
      last: boolean,
    ) => {
      if (visited.has(row.processRef)) return;
      visited.add(row.processRef);
      const guides: TreeGuide[] = depth === 0 ? [] : [...above, last ? "last" : "branch"];
      members.push({ row, depth, guides, matched: false });
      const childAbove: TreeGuide[] = depth === 0 ? [] : [...above, last ? "space" : "line"];
      const rowChildren = children.get(row.processRef) ?? [];
      rowChildren.forEach((child, index) =>
        visit(child, depth + 1, childAbove, index === rowChildren.length - 1),
      );
    };
    visit(root, 0, [], true);
    const listeners = members
      .flatMap((member) => member.row.listeners)
      .sort((left, right) => left.port - right.port);
    return { root, members, listeners, matchedBelow: false };
  });
};

/** Marks the members that hold a term of the filter, for the details and their marks. */
const markMatches = (
  members: readonly ProcessMember[],
  terms: readonly string[],
): ProcessMember[] =>
  members.map((member) => {
    const text = searchText(member.row);
    return { ...member, matched: terms.some((term) => text.includes(term)) };
  });

/**
 * The checkouts that have a matching command. A command matches when each word of the filter is
 * in one of its processes, and it keeps all its processes. It opens its details when the words
 * are not all in its first process. Commands keep the order in which they started, and
 * checkouts keep the order of the host, so a live list never moves a line that stays.
 */
export const buildGroupViews = (
  groups: readonly WorkspaceProcessGroup[],
  filter: string,
): ProcessGroupView[] => {
  const terms = filterTerms(filter);
  const filtering = terms.length > 0;
  return groups.flatMap((group) => {
    const commands: ProcessCommandView[] = [];
    const appCommands = new Map<string, ProcessCommandView[]>();
    for (const command of commandsOf(group.processes)) {
      const { launcher } = command.root;
      if (launcher === undefined) commands.push(command);
      else appCommands.set(launcher, [...(appCommands.get(launcher) ?? []), command]);
    }
    const shownCommands = commands.flatMap((command) => {
      if (!filtering) return [command];
      const texts = command.members.map((member) => searchText(member.row));
      if (!coversTerms(texts, terms)) return [];
      const members = markMatches(command.members, terms);
      const matchedBelow = !coversTerms(texts.slice(0, 1), terms);
      return [{ ...command, members, matchedBelow }];
    });
    shownCommands.sort((left, right) => left.root.pid - right.root.pid);
    const apps = [...appCommands].flatMap(([name, appRoots]): ProcessAppView[] => {
      const members = appRoots.flatMap((command) => command.members);
      const listeners = appRoots
        .flatMap((command) => command.listeners)
        .sort((left, right) => left.port - right.port);
      if (!filtering) return [{ name, members, listeners, matchedBelow: false }];
      const texts = [name.toLowerCase(), ...members.map((member) => searchText(member.row))];
      if (!coversTerms(texts, terms)) return [];
      return [
        {
          name,
          members: markMatches(members, terms),
          listeners,
          matchedBelow: !coversTerms(texts.slice(0, 1), terms),
        },
      ];
    });
    apps.sort((left, right) => left.name.localeCompare(right.name));
    if (shownCommands.length === 0 && apps.length === 0) return [];
    return [{ group, commands: shownCommands, apps }];
  });
};

/** The counts of the footer summary. The processes of other apps count only as processes. */
export const processTotals = (views: readonly ProcessGroupView[]) => {
  const entries = views.flatMap((view) => [...view.commands, ...view.apps]);
  return {
    commands: views.reduce((total, view) => total + view.commands.length, 0),
    processes: entries.reduce((total, entry) => total + entry.members.length, 0),
    ports: entries.reduce((total, entry) => total + entry.listeners.length, 0),
  };
};

/** True when a task owns the checkout. */
const ownedBy = (group: WorkspaceProcessGroup, workspaceId: string, taskId: string): boolean =>
  group.workspaceId === workspaceId &&
  group.owners.some((owner) => owner.kind === "task" && owner.taskId === taskId);

/**
 * The place of a checkout in the list: 0 for the task that the user works on, 1 for the rest of
 * the active workspace, and 2 for the other workspaces, which start folded.
 */
export const contextRank = (
  group: WorkspaceProcessGroup,
  focus: { workspaceId: string; taskId: string } | null,
  activeWorkspaceId: string | null,
): 0 | 1 | 2 => {
  if (focus && ownedBy(group, focus.workspaceId, focus.taskId)) return 0;
  return group.workspaceId === activeWorkspaceId ? 1 : 2;
};

/** The number of running commands, for the badge of the rail. Other apps' helpers do not count. */
export const runningCommandCount = (list: WorkspaceProcessList): number =>
  buildGroupViews(list.groups, "").reduce((total, view) => total + view.commands.length, 0);

/** A web port of a task, which a chip on its card opens. */
export type TaskServerLink = { port: number; url: string; title: string };

/** The web ports that run in the worktrees of a task, once each, by port number. */
export const taskServerLinks = (
  list: WorkspaceProcessList,
  workspaceId: string,
  taskId: string,
): TaskServerLink[] => {
  const links = new Map<string, TaskServerLink>();
  for (const group of list.groups) {
    if (!ownedBy(group, workspaceId, taskId)) continue;
    for (const row of group.processes)
      for (const listener of row.listeners) {
        const url = linkOf(listener);
        if (url && !links.has(url))
          links.set(url, { port: listener.port, url, title: `Open ${url} · ${row.name}` });
      }
  }
  return [...links.values()].sort((left, right) => left.port - right.port);
};

/** An absolute path in quotes, which can hold spaces. */
const QUOTED_PATH = /"((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^"]*)"/g;
/** An absolute path at the start of an argument, of an option value, or of a quote. */
const ABSOLUTE_PATH = /(?<=^|[\s"'=])(?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^\s"'=,;]*/g;
/** A folder followed by `..`, which the two cancel. */
const PARENT_STEP = /\/(?!\.\.\/)[^/]+\/\.\.\//;
const NODE_MODULES = "node_modules/";

/** A path as a person reads it: below the working directory, inside its package, or its end. */
const readablePath = (path: string, workingDirectory: string, checkoutPath: string): string => {
  let readable = path.replace(/^file:\/\//, "").replaceAll("\\", "/");
  // `node_modules/.bin/../vite/bin/vite.js` is `node_modules/vite/bin/vite.js`.
  while (PARENT_STEP.test(readable)) readable = readable.replace(PARENT_STEP, "/");
  const packageStart = readable.lastIndexOf(NODE_MODULES);
  if (packageStart !== -1) return readable.slice(packageStart + NODE_MODULES.length);
  for (const base of [workingDirectory, checkoutPath]) {
    if (readable === base) return ".";
    if (readable.startsWith(`${base}/`)) return readable.slice(base.length + 1);
  }
  const parts = readable.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : readable;
};

/**
 * A command line as a person reads it. Paths below the working directory or the checkout become
 * relative, and a path inside a package starts at the package, such as `vite/bin/vite.js`. The
 * full command shows in the title.
 */
export const readableCommand = (
  row: Pick<WorkspaceProcessRow, "command" | "directory">,
  checkoutPath: string,
): string => {
  const checkout = checkoutPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const workingDirectory = row.directory ? `${checkout}/${row.directory}` : checkout;
  const read = (path: string) => readablePath(path, workingDirectory, checkout);
  return row.command
    .replace(/\s+/g, " ")
    .trim()
    .replace(QUOTED_PATH, (_, path: string) => {
      const readable = read(path);
      return /\s/.test(readable) ? `"${readable}"` : readable;
    })
    .replace(ABSOLUTE_PATH, read);
};

/** A shell that runs one command string, such as `zsh -lc "pnpm dev"`. */
const SHELL_COMMAND = /^(?:ba|z|da|k|fi)?sh -[a-zA-Z]*c[a-zA-Z]* (.+)$/;

/** The command that a shell runs, so a command that an agent starts reads like a typed one. */
export const commandLabel = (command: string): string => {
  const script = SHELL_COMMAND.exec(command)?.[1];
  if (script === undefined) return command;
  return /^"[^"]*"$/.test(script) ? script.slice(1, -1) : script;
};

/**
 * The title of a command. A shell that runs one program shows that program, so a command that an
 * agent wraps in a script, such as `zsh -c "source snapshot.sh && eval 'pnpm dev'"`, reads like
 * the typed one.
 */
export const commandTitle = (
  command: Pick<ProcessCommandView, "root" | "members">,
  checkoutPath: string,
): string => {
  const { root } = command;
  const own = commandLabel(readableCommand(root, checkoutPath));
  if (!SHELL_COMMAND.test(root.command)) return own;
  const children = command.members.filter((member) => member.row.parentRef === root.processRef);
  const [only] = children;
  return children.length === 1 && only
    ? commandLabel(readableCommand(only.row, checkoutPath))
    : own;
};

/** The URL that a listener opens, or null for a port without a web page. */
export const linkOf = (listener: WorkspaceProcessListener | undefined): string | null =>
  listener?.browser.kind === "link" ? listener.browser.url : null;

/** The URL of the first command with a web port that a filter shows. Enter in the filter opens it. */
export const firstServerUrl = (views: readonly ProcessGroupView[]): string | null => {
  for (const view of views)
    for (const entry of [...view.commands, ...view.apps])
      for (const listener of entry.listeners) {
        const url = linkOf(listener);
        if (url) return url;
      }
  return null;
};
