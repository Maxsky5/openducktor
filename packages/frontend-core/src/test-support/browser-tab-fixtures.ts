import type { BrowserTabSummary } from "@openducktor/contracts";

/** A browser tab ID for tests. Each number gives one fixed UUID. */
export const browserTabIdFixture = (number: number): string =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

/** A loaded user tab of the task `task-1` that nobody shares. */
export const createBrowserTabSummaryFixture = (
  overrides: Partial<BrowserTabSummary> = {},
): BrowserTabSummary => ({
  tabId: browserTabIdFixture(1),
  revision: 1,
  owner: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
  createdBy: "user",
  shared: false,
  openerTabId: null,
  surface: "panel",
  page: "host",
  started: true,
  live: true,
  url: "http://localhost:3000/",
  title: "App",
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  prompts: [],
  downloads: [],
  agentActive: false,
  ...overrides,
});
