import { expect, test } from "bun:test";
import type { WorkspaceProcessGroup, WorkspaceProcessRow } from "@openducktor/contracts";
import {
  buildGroupViews,
  commandLabel,
  commandTitle,
  contextRank,
  firstServerUrl,
  processTotals,
  readableCommand,
  taskServerLinks,
} from "./processes-view";

const row = (
  pid: number,
  command: string,
  options: { parent?: number; ports?: number[]; directory?: string } = {},
): WorkspaceProcessRow => {
  const row: WorkspaceProcessRow = {
    processRef: `${pid}:${pid}0`,
    pid,
    name: command.split(" ")[0] ?? command,
    command,
    stop: { allowed: true, requiresPidReuseAcknowledgment: false, forced: false },
    listeners: (options.ports ?? []).map((port) => ({
      address: "127.0.0.1",
      port,
      browser: { kind: "link", url: `http://127.0.0.1:${port}/`, suggested: false },
    })),
  };
  if (options.parent !== undefined) row.parentRef = `${options.parent}:${options.parent}0`;
  if (options.directory !== undefined) row.directory = options.directory;
  return row;
};

const group = (checkoutPath: string, processes: WorkspaceProcessRow[]): WorkspaceProcessGroup => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  checkoutPath,
  kind: "worktree",
  owners: [],
  processes,
});

// `pnpm dev` in two apps of one checkout, as a terminal starts them, and a watcher alone.
const app = group("/repo", [
  row(10, "tsc --watch"),
  row(20, "pnpm dev", { directory: "apps/api" }),
  row(21, "pnpm dev", { parent: 20, directory: "apps/api" }),
  row(22, "node tsx/dist/cli.mjs watch src/index.ts", { parent: 21, directory: "apps/api" }),
  row(23, "node src/index.ts", { parent: 22, directory: "apps/api", ports: [3001] }),
  row(30, "pnpm dev", { directory: "apps/web" }),
  row(31, "node vite/bin/vite.js", { parent: 30, directory: "apps/web", ports: [5173] }),
  row(32, "esbuild --service", { parent: 31, directory: "apps/web" }),
]);
const quiet = group("/quiet", [row(40, "eslint --watch")]);

test("groups each process under the command that started it, in start order", () => {
  const views = buildGroupViews([quiet, app], "");
  expect(views.map((view) => view.group.checkoutPath)).toEqual(["/quiet", "/repo"]);
  const commands = views[1]?.commands ?? [];
  expect(commands.map((command) => command.root.pid)).toEqual([10, 20, 30]);
  expect(commands[1]?.members.map(({ row, depth }) => [row.pid, depth])).toEqual([
    [20, 0],
    [21, 1],
    [22, 2],
    [23, 3],
  ]);
  expect(commands[1]?.members.map((member) => member.guides.map(({ guide }) => guide))).toEqual([
    [],
    ["last"],
    ["space", "last"],
    ["space", "space", "last"],
  ]);
  expect(commands[2]?.listeners.map((listener) => listener.port)).toEqual([5173]);
  expect(processTotals(views)).toEqual({ commands: 4, processes: 9, ports: 2 });
});

test("keeps a whole command for a match and opens it for a match below the root", () => {
  const commands = (filter: string) =>
    buildGroupViews([app, quiet], filter).flatMap((view) =>
      view.commands.map((command) => [command.root.pid, command.matchedBelow]),
    );
  expect(commands("apps/web")).toEqual([[30, false]]);
  expect(commands("VITE")).toEqual([[30, true]]);
  expect(commands("3001")).toEqual([[20, true]]);
  expect(commands("eslint")).toEqual([[40, false]]);
  expect(commands("postgres")).toEqual([]);
  // Each word must match, in any process of the command and in any order.
  expect(commands("5173 web")).toEqual([[30, true]]);
  expect(commands("api :3001")).toEqual([[20, true]]);
  expect(commands("web 3001")).toEqual([]);
  const [web] = buildGroupViews([app], "vite")[0]?.commands ?? [];
  expect(web?.members.filter((member) => member.matched).map(({ row }) => row.pid)).toEqual([31]);
});

test("reads paths below the checkout and inside packages", () => {
  const read = (command: string, directory = "") =>
    readableCommand({ command, directory }, "/Users/me/repo");
  expect(
    read("node /Users/me/repo/apps/web/node_modules/.bin/../vite/bin/vite.js", "apps/web"),
  ).toBe("node vite/bin/vite.js");
  expect(
    read(
      "node --import file:///Users/me/repo/node_modules/.pnpm/tsx@4/node_modules/tsx/dist/loader.mjs src/index.ts",
      "apps/api",
    ),
  ).toBe("node --import tsx/dist/loader.mjs src/index.ts");
  expect(read("vite --config=/Users/me/repo/apps/web/vite.config.ts", "apps/web")).toBe(
    "vite --config=vite.config.ts",
  );
  expect(read("node /Users/me/repo/scripts/dev.ts")).toBe("node scripts/dev.ts");
  expect(read("node /Users/me/.nvm/versions/node/v24/bin/server.js --port 3000")).toBe(
    "node …/bin/server.js --port 3000",
  );
  expect(
    read(
      'node "/Users/me/Library/Application Support/Zed/languages/json/node_modules/json-server/bin/server" --stdio',
    ),
  ).toBe("node json-server/bin/server --stdio");
  expect(read('node "/Users/me/Library/Application Support/Zed/server.js"')).toBe(
    "node …/Zed/server.js",
  );
  expect(read("curl http://127.0.0.1:3000/health")).toBe("curl http://127.0.0.1:3000/health");
  expect(read("sh -c trap '' INT\nwhile read -r line; do")).toBe(
    "sh -c trap '' INT while read -r line; do",
  );
  expect(
    readableCommand(
      { command: "node C:\\repo\\apps\\web\\server.js", directory: "apps/web" },
      "C:\\repo",
    ),
  ).toBe("node server.js");
});

test("shows the command that a shell runs", () => {
  expect(commandLabel('zsh -lc "pnpm dev"')).toBe("pnpm dev");
  expect(commandLabel("bash -c bun run dev")).toBe("bun run dev");
  expect(commandLabel("pnpm dev")).toBe("pnpm dev");
  expect(commandLabel("zsh -l")).toBe("zsh -l");
});

test("names a wrapped agent command by the program that its shell runs", () => {
  const titles = (rows: WorkspaceProcessRow[]) =>
    (buildGroupViews([group("/repo", rows)], "")[0]?.commands ?? []).map((command) =>
      commandTitle(command, "/repo"),
    );
  const wrapper = `zsh -c "source /Users/me/.claude/shell-snapshots/snapshot.sh && eval 'rtk sleep 120' < /dev/null"`;
  expect(titles([row(50, wrapper), row(51, "rtk sleep 120", { parent: 50 })])).toEqual([
    "rtk sleep 120",
  ]);
  // A shell that runs several programs, or none yet, shows its script.
  expect(
    titles([
      row(60, 'bash -c "vite & tsc -w"'),
      row(61, "vite", { parent: 60 }),
      row(62, "tsc -w", { parent: 60 }),
    ]),
  ).toEqual(["vite & tsc -w"]);
  expect(titles([row(70, 'zsh -lc "pnpm dev"')])).toEqual(["pnpm dev"]);
  expect(titles([row(80, "pnpm dev"), row(81, "turbo run dev", { parent: 80 })])).toEqual([
    "pnpm dev",
  ]);
});

test("opens the first web port that a filter shows", () => {
  expect(firstServerUrl(buildGroupViews([app], "web"))).toBe("http://127.0.0.1:5173/");
  expect(firstServerUrl(buildGroupViews([quiet], ""))).toBeNull();
});

test("finds the worktree of a task that another workspace also opens", () => {
  // The second workspace opens the task worktree as its repository, so it keeps the group.
  const shared: WorkspaceProcessGroup = {
    ...group("/worktrees/task-1", [row(90, "pnpm dev", { ports: [5174] })]),
    workspaceId: "second",
    owners: [{ kind: "task", workspaceId: "repo", taskId: "task-1", title: "Add login" }],
  };
  const list = { groups: [shared], issues: [] };
  expect(taskServerLinks(list, "repo", "task-1").map((link) => link.port)).toEqual([5174]);
  expect(taskServerLinks(list, "second", "task-1")).toEqual([]);
  expect(contextRank(shared, { workspaceId: "repo", taskId: "task-1" }, "repo")).toBe(0);
});
