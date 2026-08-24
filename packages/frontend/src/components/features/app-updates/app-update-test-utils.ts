import { mock } from "bun:test";
import type { AppUpdateCommandResult, AppUpdateState } from "@openducktor/contracts";
import {
  type AppUpdateBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";

export type FakeAppUpdateBridge = AppUpdateBridge & {
  check: ReturnType<typeof mock>;
  download: ReturnType<typeof mock>;
  emit(state: AppUpdateState): void;
  getState: ReturnType<typeof mock>;
  install: ReturnType<typeof mock>;
};

export const createFakeAppUpdateBridge = (initialState: AppUpdateState): FakeAppUpdateBridge => {
  let currentState = initialState;
  const listeners = new Set<(state: AppUpdateState) => void>();
  const bridge = {
    getState: mock(async () => currentState),
    check: mock(async (): Promise<AppUpdateCommandResult> => ({
      accepted: true,
      state: currentState,
    })),
    download: mock(async (): Promise<AppUpdateCommandResult> => ({
      accepted: true,
      state: currentState,
    })),
    install: mock(async (): Promise<AppUpdateCommandResult> => ({
      accepted: true,
      state: currentState,
    })),
    subscribeState: async (listener: (state: AppUpdateState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(nextState: AppUpdateState) {
      currentState = nextState;
      for (const listener of listeners) {
        listener(nextState);
      }
    },
  };
  return bridge;
};

export const createTestShellBridge = (appUpdates: AppUpdateBridge): ShellBridge => ({
  ...createUnavailableShellBridge(),
  appUpdates,
  capabilities: {
    canOpenExternalUrls: true,
    canPreviewLocalAttachments: true,
  },
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
  resolveTaskAssetSrc: async () => "asset://task-preview",
});
