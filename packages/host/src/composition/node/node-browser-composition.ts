import { createBrowserScreenshotFileStore } from "../../adapters/browser/files/browser-screenshot-file-store";
import { Cause, Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import {
  createBrowserSitePermissionFileStore,
  createBrowserTabFileStore,
} from "../../adapters/browser/files/browser-file-stores";
import type { LocalAttachmentService } from "../../application/attachments/local-attachment-service";
import {
  type ManagedCallerResolver,
  type CreateManagedCallerResolverInput,
  createManagedCallerResolver,
} from "../../application/agent-sessions/managed-caller-resolver";
import {
  type BrowserCallerResolver,
  createBrowserCallerResolver,
} from "../../application/browser/browser-caller-resolver";
import { BrowserServiceError } from "../../application/browser/browser-service-error";
import { createBrowserService } from "../../application/browser/browser-service";
import type { BrowserService } from "../../application/browser/browser-service-types";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { BrowserAutomationPort } from "../../ports/browser-automation-port";
import type { BrowserEnginePort } from "../../ports/browser-engine-port";
import type { GitPort } from "../../ports/git-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../host-lifecycle";

type NodeBrowserServiceInput = {
  engine: BrowserEnginePort;
  automation: BrowserAutomationPort;
  configRoot: string;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  git: Pick<GitPort, "canonicalizePath">;
  tasks: Pick<TaskReader, "getTask">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "get" | "listRuntimeOwners">;
  liveSessions: CreateManagedCallerResolverInput["liveSessions"];
  localAttachments: Pick<LocalAttachmentService, "stage">;
  eventBus: HostEventBusPort | undefined;
  lifecycleLogger: HostLifecycleLogger;
};

/** The browser feature of the host, and the resolver that finds the owner of agent tool calls. */
export type NodeBrowser = {
  browserService: BrowserService;
  browserCallers: BrowserCallerResolver;
  managedCallers: ManagedCallerResolver;
};

export const createNodeBrowser = (input: NodeBrowserServiceInput): NodeBrowser => {
  const managedCallers = createManagedCallerResolver({
    workspaceSettings: input.settings,
    workspaceSessions: input.workspaceSessions,
    liveSessions: input.liveSessions,
  });
  return {
    browserService: createNodeBrowserService(input),
    browserCallers: createBrowserCallerResolver(managedCallers),
    managedCallers,
  };
};

const createNodeBrowserService = (input: NodeBrowserServiceInput): BrowserService =>
  createBrowserService({
    engine: input.engine,
    automation: input.automation,
    sitePermissions: createBrowserSitePermissionFileStore({ configRoot: input.configRoot }),
    screenshots: createBrowserScreenshotFileStore({ configRoot: input.configRoot }),
    savedTabs: createBrowserTabFileStore({
      configRoot: input.configRoot,
      engineKind: input.engine.kind,
    }),
    owners: {
      settings: input.settings,
      git: input.git,
      tasks: input.tasks,
      workspaceSessions: input.workspaceSessions,
    },
    stageImage: (base64Png, name) =>
      input.localAttachments.stage({ base64Data: base64Png, name }).pipe(
        Effect.mapError(
          (cause) =>
            new BrowserServiceError({
              code: "browser_action_failed",
              operation: "browser.annotation.stage_image",
              message: `Could not save the annotation image: ${cause.message}`,
              cause,
            }),
        ),
      ),
    publish: (event) =>
      input.eventBus?.publish({ channel: "openducktor://browser-event", payload: event }),
    reportFailure: (operation, cause) => {
      Effect.runFork(
        writeHostLifecycleLog(
          input.lifecycleLogger,
          "error",
          `Browser ${operation} failed: ${failureText(cause)}`,
        ).pipe(Effect.ignore),
      );
    },
  });

const failureText = (cause: unknown): string =>
  Cause.isCause(cause) ? Cause.pretty(cause) : errorMessage(cause);
