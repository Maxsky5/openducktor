import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { AgentsPageShell } from "./agents-page-shell";

function renderShell(overrides: Partial<ComponentProps<typeof AgentsPageShell>> = {}) {
  const retries = {
    onRetryNavigationPersistence: mock(() => {}),
    onRetryChatSettingsLoad: mock(() => {}),
    onRetryGitProviderContext: mock(() => {}),
  };
  render(
    <AgentsPageShell
      activeWorkspace={{ workspaceId: "repo-1", workspaceName: "repo", repoPath: "/repo" }}
      navigationPersistenceOperation="load"
      navigationPersistenceError={null}
      chatSettingsLoadError={null}
      gitProviderContextLoadError={null}
      workspace={<div>Conversation workspace</div>}
      {...retries}
      {...overrides}
    />,
  );
  return retries;
}

test("offers to retry opening a conversation with no selected repository", async () => {
  const { onRetryNavigationPersistence } = renderShell({
    activeWorkspace: null,
    navigationPersistenceError: new Error("Restore failed"),
  });

  expect(screen.getByRole("alert", { name: "Couldn't open your conversation" })).toBeDefined();
  expect(screen.queryByText("Conversation workspace")).toBeNull();
  expect(screen.queryByText("Restore failed")).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Error details" }));
  });
  expect(screen.getByText("Restore failed")).toBeDefined();
  expect(screen.queryByText("Repository", { exact: false })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetryNavigationPersistence).toHaveBeenCalledTimes(1);
});

test("opens the workspace after loading the saved selection", () => {
  renderShell();

  expect(screen.getByText("Conversation workspace")).toBeDefined();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("can retry reading chat settings while the workspace stays open", () => {
  const { onRetryChatSettingsLoad, onRetryGitProviderContext } = renderShell({
    chatSettingsLoadError: new Error("Settings read failed"),
  });

  expect(screen.getByText("Conversation workspace")).toBeDefined();
  expect(screen.getByText("Settings read failed")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Retry load" }));
  expect(onRetryChatSettingsLoad).toHaveBeenCalledTimes(1);
  expect(onRetryGitProviderContext).not.toHaveBeenCalled();
});

test("can retry reading the Git provider while the workspace stays open", () => {
  const { onRetryChatSettingsLoad, onRetryGitProviderContext } = renderShell({
    gitProviderContextLoadError: new Error("Provider context read failed"),
  });

  expect(screen.getByText("Conversation workspace")).toBeDefined();
  expect(screen.getByText("Provider context read failed")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Retry provider load" }));
  expect(onRetryGitProviderContext).toHaveBeenCalledTimes(1);
  expect(onRetryChatSettingsLoad).not.toHaveBeenCalled();
});
