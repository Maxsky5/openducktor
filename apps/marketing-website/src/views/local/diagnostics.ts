// The Diagnostics sheet of the Local view. Sources: diagnostics-panel-model.ts,
// diagnostics-host-model.ts, and diagnostics-workspace-model.ts in
// packages/frontend/src/components/features/diagnostics. The versions, the user name, and the
// paths are samples.
import type { DiagCheck, DiagOverviewData, DiagStatusData } from "../../replica/diagnostics/model";
import { CONFIG_PATH, WORKSPACE } from "../../sample/workspace";

const READY: DiagStatusData = { health: "ok", label: "Ready" };
const AVAILABLE: DiagStatusData = { health: "ok", label: "Available" };

/** The states of the checks while the host starts the runtimes and runs the checks. */
export const STARTING: DiagStatusData = { health: "busy", label: "Starting" };
export const CHECKING: DiagStatusData = { health: "loading", label: "Checking" };

/** The runtimes of the host. One shared runtime of each kind serves every workspace. */
export const RUNTIMES: readonly DiagCheck[] = [
  {
    id: "opencode",
    runtime: "opencode",
    title: "OpenCode",
    value: "opencode v2.0.31",
    details: [{ value: "/Users/sam/.opencode/bin/opencode", path: true }],
    status: READY,
    restart: true,
  },
  {
    id: "codex",
    runtime: "codex",
    title: "Codex",
    value: "codex-cli 0.163.0",
    details: [{ value: "/opt/homebrew/bin/codex", path: true }],
    status: READY,
    restart: true,
  },
  {
    id: "claude",
    runtime: "claude",
    title: "Claude",
    value: "2.1.301 (Claude Code)",
    details: [{ value: "/Users/sam/.local/bin/claude", path: true }],
    status: READY,
    restart: true,
  },
];

/** The tools and services of the host. */
export const TOOLS: readonly DiagCheck[] = [
  { id: "path", tool: "path", title: "PATH", details: [], status: AVAILABLE },
  {
    id: "git",
    tool: "git",
    title: "Git",
    value: "2.50.1 (Apple Git-155)",
    details: [{ label: "Executable", value: "/usr/bin/git", path: true }],
    status: AVAILABLE,
  },
  {
    id: "mcp-bridge",
    tool: "mcp-bridge",
    title: "OpenDucktor MCP bridge",
    details: [{ label: "Address", value: "http://127.0.0.1:41287", path: true }],
    status: READY,
  },
];

/** The checks of the selected workspace. */
export const WORKSPACE_CHECKS: readonly DiagCheck[] = [
  {
    id: "repository-setup",
    tool: "repository-setup",
    title: "Repository setup",
    details: [{ label: "Worktrees", value: `${CONFIG_PATH}/worktrees/${WORKSPACE}`, path: true }],
    status: { health: "ok", label: "Configured" },
  },
  {
    id: "task-store",
    tool: "task-store",
    title: "Task store",
    details: [
      {
        label: "Database",
        value: `${CONFIG_PATH}/task-stores/${WORKSPACE}/database.sqlite`,
        path: true,
      },
    ],
    status: READY,
  },
];

/** The overview while the checks run, and when everything works. */
export const RUNNING: DiagOverviewData = {
  tone: "checking",
  title: "Running checks",
  description: "Each result shows when its check finishes.",
};
export const HEALTHY: DiagOverviewData = {
  tone: "healthy",
  title: "Everything is working",
  description: "3 runtimes are ready. The workspace checks passed.",
};
