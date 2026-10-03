import { expect, mock, test } from "bun:test";
import type { AzureDevOpsRepository } from "@openducktor/contracts";
import { azureDevOpsConnectionConfigurationFingerprint } from "@openducktor/core";
import {
  type AzureDevOpsConnectionUpdateListener,
  configureShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { installReactActEnvironment } from "@/test-utils/react-act-environment";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { useAzureDevOpsConnectionController } from "./use-azure-devops-connection-controller";

for (const actionFailed of [false, true]) {
  test(`reconnect clears the stream warning and ${actionFailed ? "keeps the action error" : "leaves no error"}`, async () => {
    const previousBridge = getShellBridge();
    const restoreAct = installReactActEnvironment();
    const repository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "organization",
      project: "project",
      name: "repository",
    };
    const settings = createSettingsSnapshotFixture({
      workspaces: {
        "workspace-1": createRepoSettingsConfigFixture("workspace-1", "/repo", {
          id: "azure_devops",
          enabled: true,
          autoDetected: false,
          repository,
        }),
      },
    });
    let listener: AzureDevOpsConnectionUpdateListener | undefined;
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceGetSettingsSnapshot: async () => settings,
          workspaceGetAzureDevOpsConnection: async () => ({ status: "disconnected" }),
          workspaceDisconnectAzureDevOps: mock(async () => {
            throw new Error("Disconnect failed.");
          }),
        },
        bridge: {
          subscribeAzureDevOpsConnectionUpdates: async (onUpdate) => {
            listener = onUpdate;
            return () => {
              listener = undefined;
            };
          },
        },
      }),
    );
    const harness = createHookHarness(
      useAzureDevOpsConnectionController,
      {
        workspaceId: "workspace-1",
        selectedRepoPath: "/repo",
        providerState: { status: "idle" },
        providerEnabled: true,
        configurationFingerprint: azureDevOpsConnectionConfigurationFingerprint(
          "workspace-1",
          "/repo",
          repository,
        ),
        connectionInput: { repoPath: "/repo", repository },
      },
      { wrapper: IsolatedQueryWrapper },
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => state.canManageConnection && state.updatesReady, 500);
      await harness.run(() =>
        listener!({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Host connection interrupted.",
        }),
      );
      expect(harness.getLatest().actionError).toBe("Host connection interrupted.");
      if (actionFailed) {
        await harness.run((state) => state.disconnect());
        expect(harness.getLatest().actionError).toBe("Disconnect failed.");
      }
      await harness.run(() =>
        listener!({
          __openducktorBrowserLive: true,
          kind: "reconnected",
          transportEpoch: "12345678-1234-4234-9234-123456789abc",
        }),
      );
      expect(harness.getLatest().actionError).toBe(actionFailed ? "Disconnect failed." : null);
      expect(harness.getLatest().connectionReadFailed).toBe(false);
      expect(harness.getLatest().connectionState.status).toBe("disconnected");
    } finally {
      await harness.unmount();
      configureShellBridge(previousBridge);
      restoreAct();
    }
  });
}
