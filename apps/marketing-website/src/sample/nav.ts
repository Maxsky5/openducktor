// The sidebar sessions of the sample workspaces. Each view lists the sessions that it shows, and
// its scene changes them.
import type { NavEntry } from "../replica/shell/nav";
import { TASKS } from "./tasks";
import { WORKSPACE } from "./workspace";

/** Checks that each session has its key as its id. */
const byId = <const Sessions extends { [Id in keyof Sessions]: NavEntry & { id: Id } }>(
  sessions: Sessions,
): Sessions => sessions;

const here = { workspace: WORKSPACE } as const;
/** A task session that runs. Its role icon has the tone of a step in progress. */
const running = { tone: "in_progress", running: true } as const;

export const NAV_SESSIONS = byId({
  "shortcut-build": {
    ...here,
    ...running,
    id: "shortcut-build",
    title: TASKS.k3x9.title,
    runtime: "codex",
    role: "build",
    status: "in_progress",
  },
  "empty-build": {
    ...here,
    ...running,
    id: "empty-build",
    title: TASKS.p6d4.title,
    runtime: "claude",
    role: "build",
    status: "in_progress",
  },
  "focus-qa": {
    ...here,
    ...running,
    id: "focus-qa",
    title: TASKS.r9c2.title,
    runtime: "opencode",
    role: "qa",
    status: "ai_review",
  },
  "sync-build": {
    ...here,
    ...running,
    id: "sync-build",
    title: TASKS.b8t1.title,
    runtime: "claude",
    role: "build",
    status: "in_progress",
  },
  "titles-spec": {
    ...here,
    id: "titles-spec",
    title: TASKS.h5w3.title,
    runtime: "claude",
    role: "spec",
    status: "spec_ready",
    tone: "done",
    time: "12m",
  },
  "titles-planner": {
    ...here,
    ...running,
    id: "titles-planner",
    title: TASKS.h5w3.title,
    runtime: "codex",
    role: "planner",
    status: "spec_ready",
  },
  "menu-build": {
    ...here,
    ...running,
    id: "menu-build",
    title: TASKS.w5j3.title,
    runtime: "codex",
    role: "build",
    status: "in_progress",
  },
  "shortcut-qa": {
    ...here,
    ...running,
    id: "shortcut-qa",
    title: TASKS.k3x9.title,
    runtime: "opencode",
    role: "qa",
    status: "ai_review",
  },
  "typing-qa": {
    ...here,
    id: "typing-qa",
    title: TASKS.t4n8.title,
    runtime: "codex",
    role: "qa",
    status: "human_review",
    tone: "done",
    time: "25m",
  },
  "tags-chat": {
    ...here,
    id: "tags-chat",
    title: "Why do tags drop on sync?",
    runtime: "claude",
    time: "1h",
  },
  "api-build": {
    ...running,
    id: "api-build",
    workspace: "fable-api",
    title: "Rate-limit the export endpoint",
    runtime: "codex",
    role: "build",
    status: "in_progress",
    commands: true,
  },
  "theme-plan": {
    id: "theme-plan",
    workspace: "design-system",
    title: "Add a high-contrast theme",
    runtime: "opencode",
    role: "planner",
    status: "ready_for_dev",
    tone: "done",
    time: "2h",
  },
});
