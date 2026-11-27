import { describe, expect, test } from "bun:test";
import {
  countLabel,
  type ProcessGroup,
  PROCESSES_LABELS,
  processSummary,
  stopFacts,
} from "./replicas/processes/model";
import {
  AFTER_STOP,
  BEFORE_STOP,
  ON_BOARD,
  REPOSITORY_CHECKOUT,
  SERVER,
  TASK,
  TASK_CHECKOUT,
  WATCHER,
} from "./scenes/processes/sample";
import { taskId, WORKSPACE } from "./sample/workspace";
import { importProduct, readProductWords } from "./test-support/product-source";

const PROCESSES = "packages/frontend/src/components/features/processes";

/** A process of the list of the host, with the fields that the view reads. */
type Row = {
  processRef: string;
  pid: number;
  name: string;
  command: string;
  parentRef?: string;
  directory: string;
  stop: { allowed: true; requiresPidReuseAcknowledgment: false; forced: false };
  listeners: {
    address: string;
    port: number;
    browser: { kind: "link"; url: string; suggested: false };
  }[];
};
type Owner = { kind: "task"; workspaceId: string; taskId: string; title: string };
type Group = {
  workspaceId: string;
  workspaceName: string;
  checkoutPath: string;
  kind: "repository" | "worktree";
  owners: Owner[];
  processes: Row[];
};
type List = { groups: Group[]; issues: never[] };
type Member = { row: Row };
type CommandView = { root: Row; members: Member[]; listeners: Row["listeners"] };
type GroupView = { group: Group; commands: CommandView[]; apps: unknown[] };
type Focus = { workspaceId: string; taskId: string };

// SAFETY: processes-view.ts exports these functions, and a missing export fails the test.
const view = await importProduct<{
  buildGroupViews: (groups: readonly Group[], filter: string) => GroupView[];
  contextRank: (group: Group, focus: Focus | null, activeWorkspaceId: string | null) => number;
  processTotals: (views: readonly GroupView[]) => {
    commands: number;
    processes: number;
    ports: number;
  };
  runningCommandCount: (list: List) => number;
  commandTitle: (command: CommandView, checkoutPath: string) => string;
  taskServerLinks: (list: List, workspaceId: string, taskId: string) => { port: number }[];
}>(`${PROCESSES}/processes-view.ts`);
// SAFETY: processes-labels.ts exports these functions, and a missing export fails the test.
const labels = await importProduct<{
  countLabel: (count: number, one: string, many: string) => string;
  groupTitle: (group: Group) => string;
  groupSubtitle: (group: Group) => { text: string; taskIds: boolean } | null;
}>(`${PROCESSES}/processes-labels.ts`);
// The surfaces, the list, the lines, and the stop confirmation have their words in their markup.
const words = await readProductWords(
  [
    "processes-surfaces.tsx",
    "processes-panel.tsx",
    "process-group-section.tsx",
    "process-command-row.tsx",
    "process-stop-popover.tsx",
  ].map((file) => `${PROCESSES}/${file}`),
);

const WORKSPACE_ID = "workspace-fieldnotes";
const REPOSITORY = `/Users/sam/code/${WORKSPACE}`;
const WORKTREE = `/Users/sam/.openducktor/worktrees/${WORKSPACE}/${taskId(TASK)}`;
const FOCUS: Focus = { workspaceId: WORKSPACE_ID, taskId: taskId(TASK) };
const STOP = { allowed: true, requiresPidReuseAcknowledgment: false, forced: false } as const;

/** A web port on the loopback address, as the host reads it. */
const port = (number: number): Row["listeners"][number] => ({
  address: "127.0.0.1",
  port: number,
  browser: { kind: "link", url: `http://127.0.0.1:${number}/`, suggested: false },
});

/** The dev server: bun, the Vite process that it starts with the port, and esbuild below Vite. */
const SERVER_ROWS: Row[] = [
  {
    processRef: "serve",
    pid: SERVER.pid,
    name: "bun",
    command: SERVER.command,
    directory: SERVER.directory,
    stop: STOP,
    listeners: [],
  },
  {
    processRef: "vite",
    pid: SERVER.pid + 2,
    name: "node",
    command: `node ${WORKTREE}/node_modules/vite/bin/vite.js`,
    parentRef: "serve",
    directory: SERVER.directory,
    stop: STOP,
    listeners: SERVER.ports.map(port),
  },
  {
    processRef: "esbuild",
    pid: SERVER.pid + 9,
    name: "esbuild",
    command: `${WORKTREE}/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.25.0 --ping`,
    parentRef: "vite",
    directory: SERVER.directory,
    stop: STOP,
    listeners: [],
  },
];

/** The test watcher of the repository checkout: one process. */
const WATCHER_ROWS: Row[] = [
  {
    processRef: "watch",
    pid: WATCHER.pid,
    name: "bun",
    command: WATCHER.command,
    directory: WATCHER.directory,
    stop: STOP,
    listeners: [],
  },
];

/** The list of the host: the repository checkout first, as the host orders the checkouts. */
const listOf = (watcher: boolean): List => ({
  groups: [
    ...(watcher
      ? [
          {
            workspaceId: WORKSPACE_ID,
            workspaceName: WORKSPACE,
            checkoutPath: REPOSITORY,
            kind: "repository" as const,
            owners: [],
            processes: WATCHER_ROWS,
          },
        ]
      : []),
    {
      workspaceId: WORKSPACE_ID,
      workspaceName: WORKSPACE,
      checkoutPath: WORKTREE,
      kind: "worktree",
      owners: [
        {
          kind: "task",
          workspaceId: WORKSPACE_ID,
          taskId: taskId(TASK),
          title: TASK_CHECKOUT.title,
        },
      ],
      processes: SERVER_ROWS,
    },
  ],
  issues: [],
});

/**
 * The checkouts as the list shows them, in their order: on the session page of the task, or on a
 * page without a task with `focus` null.
 */
const shown = (list: List, focus: Focus | null = FOCUS): GroupView[] =>
  view
    .buildGroupViews(list.groups, "")
    .toSorted(
      (left, right) =>
        view.contextRank(left.group, focus, WORKSPACE_ID) -
        view.contextRank(right.group, focus, WORKSPACE_ID),
    );

/** The counts of the toolbar, as ProcessSummary writes them. */
const summaryOf = (views: readonly GroupView[]): string => {
  const totals = view.processTotals(views);
  const commands = labels.countLabel(totals.commands, "command", "commands");
  return totals.ports > 0
    ? `${commands} · ${labels.countLabel(totals.ports, "port", "ports")}`
    : commands;
};

/** A checkout of the replica, from the view of the app. */
const replicaOf = (
  entry: GroupView,
  sample: ProcessGroup,
  focus: Focus | null = FOCUS,
): ProcessGroup => {
  const replica: ProcessGroup = {
    id: sample.id,
    kind: entry.group.kind,
    title: labels.groupTitle(entry.group),
    focused: view.contextRank(entry.group, focus, WORKSPACE_ID) === 0,
    commands: entry.commands.map((command, index) => ({
      id: sample.commands[index]?.id ?? "",
      directory: command.root.directory,
      command: view.commandTitle(command, entry.group.checkoutPath),
      ports: command.listeners.map((listener) => listener.port),
      pid: command.root.pid,
      processes: command.members.length,
    })),
  };
  const subtitle = labels.groupSubtitle(entry.group);
  if (subtitle) replica.subtitle = subtitle.text;
  return replica;
};

describe("the Processes view copied from the app", () => {
  test("the view uses the words of the app", () => {
    for (const label of Object.values(PROCESSES_LABELS)) expect(words).toContain(label);
  });

  test("the counts use the words of the app", () => {
    for (const count of [0, 1, 2])
      for (const [one, many] of [
        ["command", "commands"],
        ["port", "ports"],
        ["process", "processes"],
      ] as const)
        expect(countLabel(count, one, many)).toBe(labels.countLabel(count, one, many));
  });

  test("the list shows the checkouts and the commands as the app gives them", () => {
    const before = shown(listOf(true));
    expect(
      before.map((entry, index) => replicaOf(entry, BEFORE_STOP[index] ?? TASK_CHECKOUT)),
    ).toEqual([...BEFORE_STOP]);
    const after = shown(listOf(false));
    expect(after.map((entry) => replicaOf(entry, TASK_CHECKOUT))).toEqual([...AFTER_STOP]);
    // The Kanban page shows no task, so no checkout has the This task badge.
    expect(
      shown(listOf(false), null).map((entry) => replicaOf(entry, TASK_CHECKOUT, null)),
    ).toEqual([...ON_BOARD]);
    expect(BEFORE_STOP.at(-1)).toBe(REPOSITORY_CHECKOUT);
  });

  test("the toolbar, the badge, and the ports of the task count as the app does", () => {
    expect(processSummary(BEFORE_STOP)).toBe(summaryOf(shown(listOf(true))));
    expect(processSummary(AFTER_STOP)).toBe(summaryOf(shown(listOf(false))));
    expect(view.runningCommandCount(listOf(true))).toBe(2);
    expect(view.runningCommandCount(listOf(false))).toBe(1);
    expect(
      view.taskServerLinks(listOf(true), WORKSPACE_ID, taskId(TASK)).map((link) => link.port),
    ).toEqual([...SERVER.ports]);
  });

  test("the stop confirmation names the folder and the PID of a command of one process", () => {
    expect(stopFacts(WATCHER).map((fact) => fact.text)).toEqual([
      WATCHER.directory,
      `PID ${WATCHER.pid}`,
    ]);
  });
});
