import { describe, expect, mock, test } from "bun:test";
import type { RepoAction, SettingsRepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { RepositoryScriptsSection } from "./settings-repository-scripts-section";

enableReactActEnvironment();

const createRepoConfig = (overrides: Partial<SettingsRepoConfig> = {}): SettingsRepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const createAction = (overrides: Partial<RepoAction> & Pick<RepoAction, "id" | "name">) => ({
  icon: "play" as const,
  command: "bun run dev",
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
  ...overrides,
});

const renderStatefulSection = (initialRepoConfig: SettingsRepoConfig) => {
  let latestRepoConfig = initialRepoConfig;

  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(initialRepoConfig);
    latestRepoConfig = selectedRepoConfig;
    return createElement(RepositoryScriptsSection, {
      selectedRepoConfig,
      loadingState: { isLoadingSettings: false, isSaving: false },
      onUpdateSelectedRepoConfig: (
        updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
      ) => {
        setSelectedRepoConfig((current) => updater(current));
      },
    });
  };

  const rendered = render(createElement(Wrapper));
  return { rendered, getLatestRepoConfig: () => latestRepoConfig };
};

const getActionDialog = (name: "Add action" | "Edit action") =>
  within(screen.getByRole("dialog", { name }));

const waitForDialogToClose = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 500 });
};

describe("RepositoryScriptsSection", () => {
  test("keeps the cleanup script and copied files and edits them as draft lines", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(createRepoConfig());

    try {
      expect(screen.getByRole("heading", { name: "Actions" })).toBeTruthy();
      expect(screen.queryByText("Worktree setup script (one command per line)")).toBeNull();

      fireEvent.change(screen.getByLabelText("Worktree cleanup script (one command per line)"), {
        target: { value: "bun run clean\n" },
      });
      fireEvent.change(screen.getByLabelText("Files copied to worktrees (one path per line)"), {
        target: { value: ".env\n" },
      });

      expect(getLatestRepoConfig().hooks.postComplete).toEqual(["bun run clean", ""]);
      expect(getLatestRepoConfig().worktreeCopyPaths).toEqual([".env", ""]);
    } finally {
      rendered.unmount();
    }
  });

  test("adds the first action from the empty state and makes it the default", async () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(createRepoConfig());

    try {
      expect(screen.getByText("No actions yet.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Add action" }));

      const dialog = getActionDialog("Add action");
      fireEvent.click(dialog.getByRole("button", { name: "Icon: Play" }));
      fireEvent.click(screen.getByRole("button", { name: "Build" }));
      expect(dialog.getByRole("button", { name: "Icon: Build" })).toBeTruthy();
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "  Build  " } });
      fireEvent.change(dialog.getByLabelText("Command"), {
        target: { value: "  bun install\nbun run build \n" },
      });
      fireEvent.click(dialog.getByRole("button", { name: "Save action" }));
      await waitForDialogToClose();

      const { actions } = getLatestRepoConfig();
      expect(actions.items).toEqual([
        {
          id: expect.any(String),
          icon: "build",
          name: "Build",
          command: "bun install\nbun run build",
          runOnWorktreeCreate: false,
          waitBeforeAgentStart: false,
        },
      ]);
      expect(actions.defaultActionId).toBe(actions.items[0]?.id ?? "missing");
      expect(screen.queryByText("No actions yet.")).toBeNull();
      expect(screen.getByText("Default")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("keeps the dialog open and shows field errors when the name or command is blank", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(createRepoConfig());

    try {
      fireEvent.click(screen.getByRole("button", { name: "Add action" }));
      const dialog = getActionDialog("Add action");
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "   " } });
      fireEvent.click(dialog.getByRole("button", { name: "Save action" }));

      expect(screen.getByRole("dialog", { name: "Add action" })).toBeTruthy();
      expect(dialog.getByText("Enter an action name.")).toBeTruthy();
      expect(dialog.getByText("Enter a command.")).toBeTruthy();
      expect(dialog.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
      expect(dialog.getByLabelText("Command").getAttribute("aria-invalid")).toBe("true");
      expect(getLatestRepoConfig().actions.items).toEqual([]);

      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Test" } });

      expect(dialog.queryByText("Enter an action name.")).toBeNull();
      expect(dialog.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
      expect(dialog.getByText("Enter a command.")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("enables the wait toggle only while the action runs on worktree creation", () => {
    const { rendered } = renderStatefulSection(createRepoConfig());

    try {
      fireEvent.click(screen.getByRole("button", { name: "Add action" }));
      const dialog = getActionDialog("Add action");
      const runOnWorktreeCreate = dialog.getByRole("switch", {
        name: "Run automatically on worktree creation",
      });
      const waitBeforeAgentStart = dialog.getByRole("switch", {
        name: "Wait for it to finish before the agent starts",
      });

      expect(runOnWorktreeCreate.getAttribute("aria-checked")).toBe("false");
      expect(waitBeforeAgentStart.hasAttribute("disabled")).toBe(true);

      fireEvent.click(runOnWorktreeCreate);
      expect(waitBeforeAgentStart.hasAttribute("disabled")).toBe(false);
      fireEvent.click(waitBeforeAgentStart);
      expect(waitBeforeAgentStart.getAttribute("aria-checked")).toBe("true");

      fireEvent.click(runOnWorktreeCreate);
      expect(waitBeforeAgentStart.getAttribute("aria-checked")).toBe("false");
      expect(waitBeforeAgentStart.hasAttribute("disabled")).toBe(true);
    } finally {
      rendered.unmount();
    }
  });

  test("shows each action with its labels and changes the default, order, and list", () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(
      createRepoConfig({
        actions: {
          items: [
            createAction({ id: "dev", name: "Dev", command: "bun install\nbun run dev" }),
            createAction({
              id: "setup",
              name: "Setup",
              icon: "configure",
              command: "bun install",
              runOnWorktreeCreate: true,
              waitBeforeAgentStart: true,
            }),
            createAction({ id: "lint", name: "Lint", icon: "lint", command: "bun run lint" }),
          ],
          defaultActionId: "dev",
        },
      }),
    );
    const itemIds = (): string[] => getLatestRepoConfig().actions.items.map(({ id }) => id);

    try {
      const rows = within(screen.getByRole("list", { name: "Actions" })).getAllByRole("listitem");
      const [devRow, setupRow] = rows;
      if (!devRow || !setupRow) {
        throw new Error("Expected action rows");
      }
      expect(within(devRow).getByText("Default")).toBeTruthy();
      expect(within(devRow).getByText("bun install")).toBeTruthy();
      expect(within(devRow).queryByText("bun run dev")).toBeNull();
      expect(within(devRow).queryByRole("button", { name: "Set Dev as default" })).toBeNull();
      expect(within(setupRow).getByText("Runs on worktree creation")).toBeTruthy();
      expect(within(setupRow).getByText("Agent waits")).toBeTruthy();
      expect(within(setupRow).queryByText("Default")).toBeNull();
      expect(screen.getByRole("button", { name: "Move Dev up" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByRole("button", { name: "Move Lint down" }).hasAttribute("disabled")).toBe(
        true,
      );

      fireEvent.click(screen.getByRole("button", { name: "Set Lint as default" }));
      expect(getLatestRepoConfig().actions.defaultActionId).toBe("lint");

      fireEvent.click(screen.getByRole("button", { name: "Move Lint up" }));
      expect(itemIds()).toEqual(["dev", "lint", "setup"]);
      fireEvent.click(screen.getByRole("button", { name: "Move Dev down" }));
      expect(itemIds()).toEqual(["lint", "dev", "setup"]);

      fireEvent.click(screen.getByRole("button", { name: "Delete Lint" }));
      expect(itemIds()).toEqual(["dev", "setup"]);
      expect(getLatestRepoConfig().actions.defaultActionId).toBe("dev");
    } finally {
      rendered.unmount();
    }
  });

  test("edits an action in place and keeps its id", async () => {
    const { rendered, getLatestRepoConfig } = renderStatefulSection(
      createRepoConfig({
        actions: {
          items: [
            createAction({ id: "dev", name: "Dev" }),
            createAction({ id: "test", name: "Test", icon: "test", command: "bun test" }),
          ],
          defaultActionId: "dev",
        },
      }),
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: "Edit Test" }));
      const dialog = getActionDialog("Edit action");
      expect(dialog.getByLabelText<HTMLInputElement>("Name").value).toBe("Test");
      expect(dialog.getByLabelText<HTMLTextAreaElement>("Command").value).toBe("bun test");
      expect(dialog.getByRole("button", { name: "Icon: Test" })).toBeTruthy();

      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Unit tests" } });
      fireEvent.click(
        dialog.getByRole("switch", { name: "Run automatically on worktree creation" }),
      );
      fireEvent.click(dialog.getByRole("button", { name: "Save action" }));
      await waitForDialogToClose();

      expect(getLatestRepoConfig().actions).toEqual({
        items: [
          createAction({ id: "dev", name: "Dev" }),
          createAction({
            id: "test",
            name: "Unit tests",
            icon: "test",
            command: "bun test",
            runOnWorktreeCreate: true,
          }),
        ],
        defaultActionId: "dev",
      });
    } finally {
      rendered.unmount();
    }
  });

  test("discards dialog edits when the user cancels", async () => {
    const initialRepoConfig = createRepoConfig({
      actions: { items: [createAction({ id: "dev", name: "Dev" })], defaultActionId: "dev" },
    });
    const { rendered, getLatestRepoConfig } = renderStatefulSection(initialRepoConfig);

    try {
      fireEvent.click(screen.getByRole("button", { name: "Edit Dev" }));
      const dialog = getActionDialog("Edit action");
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Renamed" } });
      fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
      await waitForDialogToClose();

      expect(getLatestRepoConfig()).toBe(initialRepoConfig);
    } finally {
      rendered.unmount();
    }
  });

  test("disables the full section while saving", () => {
    const rendered = render(
      createElement(RepositoryScriptsSection, {
        selectedRepoConfig: createRepoConfig({
          actions: { items: [createAction({ id: "dev", name: "Dev" })], defaultActionId: "dev" },
        }),
        loadingState: { isLoadingSettings: false, isSaving: true },
        onUpdateSelectedRepoConfig: () => {},
      }),
    );

    try {
      for (const name of ["Add action", "Edit Dev", "Delete Dev"]) {
        expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
      }
      expect(
        screen.getByLabelText<HTMLTextAreaElement>("Worktree cleanup script (one command per line)")
          .disabled,
      ).toBe(true);
    } finally {
      rendered.unmount();
    }
  });

  test("handles one semantic focus request exactly once", () => {
    const scrollIntoView = mock(() => {});
    const onFocusRequestHandled = mock(() => {});
    const focusRequest: SettingsContentFocusRequest = { kind: "repository-actions" };
    const props = {
      selectedRepoConfig: createRepoConfig(),
      loadingState: { isLoadingSettings: false, isSaving: false },
      onFocusRequestHandled,
      onUpdateSelectedRepoConfig: () => {},
    };
    const rendered = render(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest: null,
      }),
    );
    const actionsAnchor = rendered.container.querySelector("#repository-actions");
    if (!(actionsAnchor instanceof HTMLElement)) {
      throw new Error("Expected actions list anchor");
    }
    actionsAnchor.scrollIntoView = scrollIntoView;

    rendered.rerender(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest,
      }),
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onFocusRequestHandled).toHaveBeenCalledWith(focusRequest);
    rendered.rerender(
      createElement(RepositoryScriptsSection, {
        ...props,
        focusRequest,
      }),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });
});
