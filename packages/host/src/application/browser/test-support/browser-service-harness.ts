import {
  type BrowserHostEvent,
  type BrowserTabOwner,
  type BrowserTabSummary,
  repoConfigSchema,
  taskCardSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostResourceError } from "../../../effect/host-errors";
import type { BrowserAutomationPort } from "../../../ports/browser-automation-port";
import type { BrowserEnginePort } from "../../../ports/browser-engine-port";
import type {
  BrowserSitePermissionFile,
  BrowserSitePermissionPort,
} from "../../../ports/browser-site-permission-port";
import type {
  BrowserSavedTab,
  BrowserSavedTabsFile,
  BrowserTabStorePort,
} from "../../../ports/browser-tab-store-port";
import { createBrowserEngineTestDouble } from "../../../test-support/browser-engine-test-double";
import { workspaceSessionRecord } from "../../terminals/test-support/terminal-service-harness";
import { createBrowserService } from "../browser-service";

export const taskOwner: Extract<BrowserTabOwner, { kind: "task" }> = {
  kind: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
};

export const sessionOwner: BrowserTabOwner = {
  kind: "workspace_session",
  workspaceId: "workspace-1",
  sessionId: "session-1",
};

const repoConfig = repoConfigSchema.parse({
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
});

const unusedAutomation: BrowserAutomationPort = {
  connect: () => Effect.die(new Error("The automation client is not used in this test.")),
};

/** Builds a browser service with in-memory owners and storage and a page-less engine double. */
export const createBrowserServiceHarness = (
  input: {
    engine?: Partial<BrowserEnginePort>;
    archivedSessions?: string[];
    /** Runs before each task lookup, so a test can hold an owner check. */
    beforeTaskLookup?: Effect.Effect<void>;
    /** Runs before each read of saved site permissions, so a test can hold it. */
    beforeSitePermissionRead?: Effect.Effect<void>;
    /** The saved tabs of the last run. */
    savedTabs?: BrowserSavedTab[];
    /** The saved tab file cannot be read. */
    savedTabsUnreadable?: boolean;
  } = {},
) => {
  const engineDouble = createBrowserEngineTestDouble(input.engine);
  const events: BrowserHostEvent[] = [];
  const sitePermissionFiles = new Map<string, BrowserSitePermissionFile>();
  const knownTasks = new Set(["task-1", "task-2"]);
  const archived = new Set(input.archivedSessions ?? []);
  const sitePermissions: BrowserSitePermissionPort = {
    read: (workspaceId) =>
      (input.beforeSitePermissionRead ?? Effect.void).pipe(
        Effect.andThen(() =>
          Effect.succeed(sitePermissionFiles.get(workspaceId) ?? { version: 1, sites: {} }),
        ),
      ),
    write: (workspaceId, file) =>
      Effect.sync(() => void sitePermissionFiles.set(workspaceId, file)),
    remove: (workspaceId) => Effect.sync(() => void sitePermissionFiles.delete(workspaceId)),
  };
  const savedFile: BrowserSavedTabsFile = { version: 1, tabs: input.savedTabs ?? [] };
  const tabFile = { current: savedFile, writes: 0, failWrites: false };
  const savedTabs: BrowserTabStorePort = {
    path: "/config/browser/chrome_for_testing-tabs.json",
    read: () =>
      input.savedTabsUnreadable
        ? Effect.fail(
            new HostOperationError({ operation: "test.read", message: "Unexpected token." }),
          )
        : Effect.succeed(tabFile.current),
    write: (file) =>
      Effect.suspend(() => {
        tabFile.writes += 1;
        if (tabFile.failWrites) {
          return Effect.fail(
            new HostOperationError({ operation: "test.write", message: "The disk is full." }),
          );
        }
        tabFile.current = file;
        return Effect.void;
      }),
  };
  let nextId = 0;
  const service = createBrowserService({
    engine: engineDouble.engine,
    automation: unusedAutomation,
    sitePermissions,
    savedTabs,
    owners: {
      settings: { getRepoConfig: () => Effect.succeed(repoConfig) },
      git: { canonicalizePath: (path) => Effect.succeed(path) },
      tasks: {
        getTask: ({ taskId }) =>
          (input.beforeTaskLookup ?? Effect.void).pipe(
            Effect.andThen(() =>
              knownTasks.has(taskId)
                ? Effect.succeed(
                    taskCardSchema.parse({
                      id: taskId,
                      title: "Task",
                      status: "in_progress",
                      issueType: "task",
                      createdAt: "2026-01-01T00:00:00.000Z",
                      updatedAt: "2026-01-01T00:00:00.000Z",
                    }),
                  )
                : Effect.fail(
                    new HostResourceError({
                      resource: "task",
                      message: `Task ${taskId} was not found.`,
                    }),
                  ),
            ),
          ),
      },
      workspaceSessions: {
        get: ({ sessionId }) =>
          Effect.succeed({
            ...workspaceSessionRecord(sessionId, {
              kind: "local_repo_root",
              workingDirectory: "/repo",
            }),
            archivedAt: archived.has(sessionId) ? 2 : null,
          }),
      },
    },
    stageImage: () => Effect.succeed({ path: "/tmp/annotation.png" }),
    publish: (event) => events.push(event),
    reportFailure: () => {},
    newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
  });
  return { service, engine: engineDouble, events, sitePermissionFiles, tabFile };
};

export const tabId = (index: number): string =>
  `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** The summary of a live user tab of `taskOwner` that is not shared. */
export const tabSummary = (change: Partial<BrowserTabSummary> = {}): BrowserTabSummary => ({
  tabId: tabId(1),
  revision: 1,
  owner: taskOwner,
  createdBy: "user",
  shared: false,
  openerTabId: null,
  surface: "panel",
  page: "host",
  started: true,
  live: true,
  url: "http://localhost:3000/",
  title: null,
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  prompts: [],
  downloads: [],
  agentActive: false,
  ...change,
});

/** Waits until background jobs of the service reach a state that a test can see. */
export const waitUntil = async (condition: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("The expected state did not come in time.");
    await new Promise((resolve) => setImmediate(resolve));
  }
};
