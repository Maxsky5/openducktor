// The Diagnostics sheet of the Local view. Sources: diagnostics-panel.tsx,
// diagnostics-panel-sections.tsx, and the diagnostics-*-model.ts files in
// packages/frontend/src/components/features/diagnostics. The repository, the user name, and
// the paths are samples.
import type { DiagState } from "../../replica/diagnostics/model";
import type { RuntimeKind } from "../../sample/models";
import { CONFIG_PATH, REPOSITORY_PATH, WORKSPACE } from "../../sample/workspace";

/** A section of the sheet with its hooks for the scene, and its state in the last frame. */
type Section = { title: string; hooks: Record<string, string>; state: DiagState };

const tools = [
  { label: "Git", value: "git version 2.50.1 (Apple Git-155)" },
  { label: "OpenCode", value: "1.18.32" },
  { label: "Codex", value: "codex-cli 0.142.5" },
  { label: "Claude", value: "2.1.283 (Claude Code)" },
];

// Claude has no MCP status surface, so it has no MCP section.
const runtimes: readonly { kind: RuntimeKind; label: string; mcp: boolean }[] = [
  { kind: "opencode", label: "OpenCode", mcp: true },
  { kind: "codex", label: "Codex", mcp: true },
  { kind: "claude", label: "Claude", mcp: false },
];

type Runtime = (typeof runtimes)[number];

function runtimeSection(runtime: Runtime): Section {
  return {
    title: `${runtime.label} Runtime`,
    hooks: { "data-section": "runtime", "data-runtime": runtime.kind },
    state: {
      badge: "Running",
      tone: "success",
      rows: [{ label: "Working directory", value: REPOSITORY_PATH, muted: true, breakAll: true }],
    },
  };
}

function mcpSection(runtime: Runtime): Section {
  return {
    title: `${runtime.label} OpenDucktor MCP`,
    hooks: { "data-section": "mcp", "data-runtime": runtime.kind },
    state: {
      badge: "Connected",
      tone: "success",
      rows: [
        { label: "Server name", value: "openducktor", mono: true },
        { label: "Status", value: "connected", strong: true },
        { label: "Tools detected", value: "14", mono: true, muted: true },
      ],
    },
  };
}

/** The sections in the last frame: every check passed. */
export const SECTIONS: readonly Section[] = [
  {
    title: "Repository",
    hooks: {},
    state: {
      badge: "Configured",
      tone: "success",
      rows: [
        { label: "Repository", value: WORKSPACE },
        { label: "Repository path", value: REPOSITORY_PATH, muted: true, breakAll: true },
        {
          label: "Worktree directory",
          value: `${CONFIG_PATH}/worktrees/${WORKSPACE}`,
          muted: true,
          breakAll: true,
        },
      ],
    },
  },
  {
    title: "CLI Tools",
    hooks: { "data-section": "cli" },
    state: { badge: "Available", tone: "success", rows: tools },
  },
  ...runtimes.flatMap((runtime) =>
    runtime.mcp ? [runtimeSection(runtime), mcpSection(runtime)] : [runtimeSection(runtime)],
  ),
  {
    title: "Task Store",
    hooks: { "data-section": "store" },
    state: {
      badge: "Ready",
      tone: "success",
      rows: [
        { label: "Status", value: "Ready" },
        { label: "Health category", value: "Healthy" },
        {
          label: "SQLite database path",
          value: `${CONFIG_PATH}/task-stores/${WORKSPACE}/database.sqlite`,
          mono: true,
          muted: true,
          breakAll: true,
        },
      ],
    },
  },
];

/** The states of the sections while the checks load and the runtimes start. */
export const LOADING = {
  "cli-loading": { badge: "Checking", tone: "secondary", empty: "CLI checks are loading..." },
  "runtime-loading": {
    badge: "Checking",
    tone: "secondary",
    empty: "Runtime health is loading...",
  },
  "runtime-starting": {
    badge: "Starting",
    tone: "warning",
    rows: [
      { label: "Stage", value: "waiting for runtime", muted: true },
      { label: "Detail", value: "Runtime startup is in progress.", muted: true },
      { label: "Attempts", value: "0", mono: true, muted: true },
    ],
  },
  "mcp-loading": { badge: "Checking", tone: "secondary", empty: "MCP health is loading..." },
  "mcp-waiting": {
    badge: "Waiting on runtime",
    tone: "warning",
    rows: [
      { label: "Server name", value: "openducktor", mono: true },
      { label: "Status", value: "waiting for runtime", muted: true },
      { label: "Activity", value: "Waiting for runtime startup", muted: true },
    ],
  },
  "store-loading": { badge: "Checking", tone: "secondary" },
} satisfies Record<string, DiagState>;

export type LocalTemplate = keyof typeof LOADING;
