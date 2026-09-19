import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { AzureDevOpsConnectionSettings } from "./azure-devops-connection-settings";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

type ConnectionController = Parameters<typeof AzureDevOpsConnectionSettings>[0]["controller"];

const createPendingController = (): ConnectionController => ({
  actionError: null,
  canManageConnection: true,
  cancelSignIn: mock(() => {}),
  connectionInput: {
    repoPath: "/repo",
    repository: {
      providerId: "azure_devops",
      name: "repository",
      project: "project",
      organization: "organization",
      serviceUrl: "https://dev.azure.com",
      deployment: "services",
    },
  },
  connectionState: {
    status: "pending",
    deviceCode: {
      attemptId: "ed07cba2-2d92-45f6-b649-30e4195fd263",
      verificationUri: "https://microsoft.com/devicelogin",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-09-20T22:00:00.000Z",
    },
  },
  consentGranted: false,
  disconnect: mock(() => {}),
  draft: {
    deployment: "services",
    serviceUrl: "https://dev.azure.com",
    organization: "organization",
    project: "project",
    name: "repository",
  },
  httpCollectionUrl: null,
  isMutatingConnection: false,
  pat: "",
  providerEnabled: true,
  savePat: mock(() => {}),
  setPat: mock(() => {}),
  startSignIn: mock(() => {}),
});

describe("AzureDevOpsConnectionSettings", () => {
  test("makes the pending Microsoft sign-in actions direct and accessible", async () => {
    const openExternalUrl = mock(async () => {});
    const writeText = mock(async () => {});
    const restoreClipboard = replaceNavigatorClipboard(writeText);
    configureShellBridge(createShellBridgeFixture({ bridge: { openExternalUrl } }));

    try {
      render(
        <AzureDevOpsConnectionSettings
          controller={createPendingController()}
          disabled={false}
          onBack={() => {}}
          onSaveSettings={async () => true}
        />,
      );

      expect(screen.queryByText("Pull request actions")).toBeNull();
      expect(screen.getByRole("button", { name: "Change repository" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).toBeNull();
      const signInLink = screen.getByRole("link", { name: "Open Microsoft sign-in" });
      expect(signInLink.getAttribute("href")).toBe("https://microsoft.com/devicelogin");
      expect(signInLink.closest(".bg-info-surface")).toBeNull();

      fireEvent.click(signInLink);
      await waitFor(() =>
        expect(openExternalUrl).toHaveBeenCalledWith("https://microsoft.com/devicelogin"),
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD-EFGH"));
      expect(screen.getByRole("button", { name: "Cancel sign-in" })).toBeTruthy();
    } finally {
      restoreClipboard();
    }
  });
});
