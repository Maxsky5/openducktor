import { mock } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { act, type PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { WorkspaceOperationsHostClient } from "./workspace-operations-types";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

export const IsolatedQueryWrapper = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

export const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

export const createWorkspaceHostClient = (): WorkspaceOperationsHostClient =>
  ({
    workspaceList: async () => [],
    workspaceAdd: async (repoPath: string) => workspace(repoPath),
    workspaceSelect: async (repoPath: string) => workspace(repoPath, true),
    workspaceGetRepoConfig: async () => {
      throw new Error("workspaceGetRepoConfig not configured");
    },
    workspaceGetSettingsSnapshot: async () => {
      throw new Error("workspaceGetSettingsSnapshot not configured");
    },
    runtimeEnsure: async () => {
      throw new Error("runtimeEnsure not configured");
    },
    gitGetCurrentBranch: async () => {
      throw new Error("gitGetCurrentBranch not configured");
    },
    gitGetBranches: async () => {
      throw new Error("gitGetBranches not configured");
    },
    gitGetWorktreeStatus: async () => {
      throw new Error("gitGetWorktreeStatus not configured");
    },
    gitGetWorktreeStatusSummary: async () => {
      throw new Error("gitGetWorktreeStatusSummary not configured");
    },
    gitSwitchBranch: async () => {
      throw new Error("gitSwitchBranch not configured");
    },
  }) as WorkspaceOperationsHostClient;

export const createWorkspaceRuntimeSummary = (repoPath: string) => ({
  kind: "opencode" as const,
  runtimeId: `runtime:${repoPath}`,
  repoPath,
  taskId: null,
  role: "workspace" as const,
  workingDirectory: repoPath,
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:3030",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

export const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

export const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

export const createBrowserListenerHarness = (
  visibilityState: DocumentVisibilityState = "visible",
): {
  addWindowEventListener: ReturnType<typeof mock>;
  removeWindowEventListener: ReturnType<typeof mock>;
  addDocumentEventListener: ReturnType<typeof mock>;
  removeDocumentEventListener: ReturnType<typeof mock>;
  triggerFocus: () => Promise<void>;
  triggerVisibilityChange: (nextVisibilityState?: DocumentVisibilityState) => Promise<void>;
  restoreBrowserGlobals: () => void;
} => {
  let focusHandler: (() => void) | null = null;
  let visibilityChangeHandler: (() => void) | null = null;
  let currentVisibilityState = visibilityState;
  const originalWindowAddEventListener = window.addEventListener.bind(window);
  const originalWindowRemoveEventListener = window.removeEventListener.bind(window);
  const originalDocumentAddEventListener = document.addEventListener.bind(document);
  const originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  const addWindowEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "focus" && typeof handler === "function") {
        focusHandler = handler as () => void;
      }
    },
  );
  const removeWindowEventListener = mock(() => {});
  const addDocumentEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "visibilitychange" && typeof handler === "function") {
        visibilityChangeHandler = handler as () => void;
      }
    },
  );
  const removeDocumentEventListener = mock(() => {});

  window.addEventListener = addWindowEventListener as typeof window.addEventListener;
  window.removeEventListener = removeWindowEventListener as typeof window.removeEventListener;
  document.addEventListener = addDocumentEventListener as typeof document.addEventListener;
  document.removeEventListener = removeDocumentEventListener as typeof document.removeEventListener;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get() {
      return currentVisibilityState;
    },
  });

  const restoreBrowserGlobals = () => {
    window.addEventListener = originalWindowAddEventListener;
    window.removeEventListener = originalWindowRemoveEventListener;
    document.addEventListener = originalDocumentAddEventListener;
    document.removeEventListener = originalDocumentRemoveEventListener;

    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  };

  return {
    addWindowEventListener,
    removeWindowEventListener,
    addDocumentEventListener,
    removeDocumentEventListener,
    triggerFocus: async () => {
      if (!focusHandler) {
        throw new Error("Expected focus handler to be registered");
      }

      await act(async () => {
        focusHandler?.();
      });
      await flush();
    },
    triggerVisibilityChange: async (nextVisibilityState = "visible") => {
      currentVisibilityState = nextVisibilityState;
      if (!visibilityChangeHandler) {
        throw new Error("Expected visibilitychange handler to be registered");
      }

      await act(async () => {
        visibilityChangeHandler?.();
      });
      await flush();
    },
    restoreBrowserGlobals,
  };
};
