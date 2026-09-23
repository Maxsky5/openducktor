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
  connectionReadFailed: false,
  connectionState: {
    status: "pending",
    deviceCode: {
      attemptId: "ed07cba2-2d92-45f6-b649-30e4195fd263",
      verificationUri: "https://microsoft.com/devicelogin",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-09-20T22:00:00.000Z",
    },
  },
  disconnect: mock(() => {}),
  draft: {
    deployment: "services",
    serviceUrl: "https://dev.azure.com",
    organization: "organization",
    project: "project",
    name: "repository",
  },
  httpConsentSaved: true,
  isMutatingConnection: false,
  pat: "",
  providerEnabled: true,
  retryConnectionRead: mock(() => {}),
  savePat: mock(() => {}),
  setPat: mock(() => {}),
  startSignIn: mock(() => {}),
  updatesReady: true,
});

describe("AzureDevOpsConnectionSettings", () => {
  test("waits for connection updates before Microsoft sign-in", () => {
    const startSignIn = mock(() => {});
    render(
      <AzureDevOpsConnectionSettings
        controller={{
          ...createPendingController(),
          connectionState: { status: "disconnected" },
          updatesReady: false,
          startSignIn,
        }}
        disabled={false}
        onBack={() => {}}
        onSaveSettings={async () => true}
      />,
    );

    const button = screen.getByRole("button", { name: "Sign in with Microsoft" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(startSignIn).not.toHaveBeenCalled();
  });

  test("requires saved HTTP consent before PAT validation", () => {
    const savePat = mock(() => {});
    render(
      <AzureDevOpsConnectionSettings
        controller={{
          ...createPendingController(),
          connectionState: { status: "disconnected" },
          draft: {
            deployment: "server",
            serviceUrl: "http://azure.example.test/installation",
            organization: "DefaultCollection",
            project: "project",
            name: "repository",
          },
          httpConsentSaved: false,
          pat: "secret",
          savePat,
        }}
        disabled={false}
        onBack={() => {}}
        onSaveSettings={async () => true}
      />,
    );

    const button = screen.getByRole("button", { name: "Save and validate PAT" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(savePat).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm the HTTP connection in Repository/)).toBeTruthy();
  });

  test("shows the supported Azure DevOps Services account options", () => {
    const controller = {
      ...createPendingController(),
      connectionState: { status: "disconnected" as const },
    };

    render(
      <AzureDevOpsConnectionSettings
        controller={controller}
        disabled={false}
        onBack={() => {}}
        onSaveSettings={async () => true}
      />,
    );

    expect(screen.getByText("Work or school account")).toBeTruthy();
    expect(screen.getByText("Personal Microsoft account")).toBeTruthy();
    expect(
      screen.getByText(
        "Microsoft sign-in supports work or school accounts only. Use a personal access token for a personal Microsoft account.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.getByLabelText("Personal access token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and validate PAT" })).toBeTruthy();
  });

  test("offers PAT replacement without work-account sign-in when connected by PAT", () => {
    const savePat = mock(() => {});
    render(
      <AzureDevOpsConnectionSettings
        controller={{
          ...createPendingController(),
          connectionState: { status: "connected", account: null },
          pat: "replacement",
          savePat,
        }}
        disabled={false}
        onBack={() => {}}
        onSaveSettings={async () => true}
      />,
    );

    expect(screen.getByText("Connected with a personal access token.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in with Microsoft" })).toBeNull();
    expect(screen.getByLabelText("New personal access token")).toBeTruthy();
    expect(screen.getByText("Your current token stays active if validation fails.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace PAT" }));
    expect(savePat).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  test("offers PAT replacement for a connected Azure DevOps Server", () => {
    const controller = createPendingController();
    render(
      <AzureDevOpsConnectionSettings
        controller={{
          ...controller,
          connectionState: { status: "connected", account: null },
          draft: {
            ...controller.draft,
            deployment: "server",
            serviceUrl: "https://ado.example/installation",
          },
        }}
        disabled={false}
        onBack={() => {}}
        onSaveSettings={async () => true}
      />,
    );

    expect(screen.getByLabelText("New personal access token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace PAT" })).toBeTruthy();
  });

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
      expect(
        screen.getByText("Microsoft sign-in accepts work or school accounts only."),
      ).toBeTruthy();
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
