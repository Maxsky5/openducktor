import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  settingsSnapshotSchema,
  type SystemSettings,
  type SystemOpenInToolInfo,
} from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { toRightPanelStorageKey } from "@/pages/agents/agents-page-selection";
import { host } from "@/state/operations/host";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { withMockedToast } from "@/test-utils/mock-toast";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { OpenInMenu } from "./open-in-menu";

enableReactActEnvironment();

const REACT_ACT_ENVIRONMENT_WARNING =
  "The current testing environment is not configured to support act";

const runWithReactAct = async (run: () => void | Promise<void>): Promise<void> => {
  await withCapturedConsole("error", async (calls) => {
    await act(run);
    for (const call of calls) {
      expect(String(call[0] ?? "")).toContain(REACT_ACT_ENVIRONMENT_WARNING);
    }
  });
};

describe("OpenInMenu", () => {
  let rendered: ReturnType<typeof render> | null = null;

  const originalGetSettings = host.workspaceGetSettingsSnapshot;
  const originalSaveSettings = host.workspaceSaveSettingsSnapshot;
  let system: SystemSettings = {};
  const saveSettings = mock(async () => []);

  beforeEach(() => {
    system = {};
    saveSettings.mockClear();
    host.workspaceGetSettingsSnapshot = async () =>
      settingsSnapshotSchema.parse({ theme: "light", system });
    host.workspaceSaveSettingsSnapshot = saveSettings;
    enableReactActEnvironment();
  });

  afterEach(async () => {
    if (rendered) {
      await runWithReactAct(async () => {
        rendered?.unmount();
      });
      rendered = null;
    }
    host.workspaceGetSettingsSnapshot = originalGetSettings;
    host.workspaceSaveSettingsSnapshot = originalSaveSettings;
    globalThis.localStorage.clear();
  });

  test("renders discovered tools with icons and dispatches the selected tool", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "ghostty", iconDataUrl: "data:image/png;base64,ghostty" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});
    host.systemListOpenInTools = systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-finder");
      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Finder",
      );
      expect(
        screen.getByTestId("agent-studio-git-open-in-default-button").getAttribute("aria-label"),
      ).toBe("Open task worktree in Finder");

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-icon-ghostty")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-icon-zed")).toBeTruthy();
      expect(screen.queryByText("Files")).toBeNull();
      expect(screen.queryByText("Terminals")).toBeNull();
      expect(screen.queryByText("Editors & IDEs")).toBeNull();
      expect(screen.queryByTestId("agent-studio-git-open-in-item-finder")).toBeNull();
      expect(
        screen.getByTestId<HTMLImageElement>("agent-studio-git-open-in-icon-zed").tagName,
      ).toBe("IMG");

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-item-ghostty"));
      });

      expect(onOpenInTool).toHaveBeenCalledWith("ghostty");
      expect(saveSettings).not.toHaveBeenCalled();
      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Finder",
      );
      expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
      expect(systemListOpenInTools).toHaveBeenCalledTimes(1);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("waits for the saved preference before enabling the default action", async () => {
    const settings = createDeferred<ReturnType<typeof settingsSnapshotSchema.parse>>();
    host.workspaceGetSettingsSnapshot = () => settings.promise;
    const originalList = host.systemListOpenInTools;
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    const onOpenInTool = mock(async () => {});
    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="repository"
              targetPath="/repo"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );
      await screen.findByTestId("agent-studio-git-open-in-icon-finder");
      const button = screen.getByTestId<HTMLButtonElement>(
        "agent-studio-git-open-in-default-button",
      );
      expect(button.disabled).toBe(true);
      await runWithReactAct(async () => {
        fireEvent.click(button);
      });
      expect(onOpenInTool).not.toHaveBeenCalled();
      await runWithReactAct(async () => {
        settings.resolve(
          settingsSnapshotSchema.parse({
            theme: "light",
            system: { preferredOpenInToolId: "zed" },
          }),
        );
      });
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(button.textContent).toContain("Zed");
    } finally {
      host.systemListOpenInTools = originalList;
    }
  });

  test("opening another tool keeps the Settings preference in both mounted menus", async () => {
    system = { preferredOpenInToolId: "finder" };
    const originalList = host.systemListOpenInTools;
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    let completeLaunch!: () => void;
    const launched = new Promise<void>((resolve) => {
      completeLaunch = resolve;
    });
    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="repository"
              targetPath="/tmp/repo"
              disabledReason={null}
              onOpenInTool={() => launched}
            />
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktree"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );
      await screen.findByRole("button", { name: "Open repository root in Finder" });
      await runWithReactAct(async () => {
        fireEvent.click(screen.getAllByTestId("agent-studio-git-open-in-trigger")[0]!);
      });
      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-item-zed"));
      });
      expect(saveSettings).not.toHaveBeenCalled();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Open repository root in Finder" })
          .disabled,
      ).toBe(true);
      await runWithReactAct(async () => {
        completeLaunch();
      });
      await waitFor(
        () =>
          expect(screen.getByRole("button", { name: "Open task worktree in Finder" })).toBeTruthy(),
        { timeout: 700 },
      );
      expect(saveSettings).not.toHaveBeenCalled();
      expect(system).toEqual({ preferredOpenInToolId: "finder" });
      expect(screen.getByRole("button", { name: "Open repository root in Finder" })).toBeTruthy();
    } finally {
      host.systemListOpenInTools = originalList;
    }
  });

  test("updates the default when Settings changes or clears the preference", async () => {
    const originalList = host.systemListOpenInTools;
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    const queryClient = createQueryClient();
    try {
      rendered = render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <OpenInMenu
              contextMode="repository"
              targetPath="/tmp/repo"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
      await screen.findByRole("button", { name: "Open repository root in Finder" });
      for (const [preference, label] of [
        [{ preferredOpenInToolId: "zed" }, "Zed"],
        [{}, "Finder"],
      ] as const) {
        system = preference;
        await runWithReactAct(async () => {
          await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.settingsSnapshot() });
        });
        await screen.findByRole("button", { name: `Open repository root in ${label}` });
      }
      expect(saveSettings).not.toHaveBeenCalled();
    } finally {
      host.systemListOpenInTools = originalList;
    }
  });

  test("shows an actionable disabled reason when the target path is unavailable", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath={null}
              disabledReason="Task worktree path is unavailable. Refresh the Git panel and try again."
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      const trigger: HTMLButtonElement = screen.getByTestId("agent-studio-git-open-in-trigger");
      const disabledTrigger = screen.getByTestId("agent-studio-git-open-in-disabled-trigger");

      expect(trigger.disabled).toBe(true);
      expect(disabledTrigger).toBeTruthy();
      expect(
        screen.getByText(
          "Task worktree path is unavailable. Refresh the Git panel and try again.",
          { selector: "span.sr-only" },
        ).textContent,
      ).toContain("Task worktree path is unavailable. Refresh the Git panel and try again.");
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("disables the trigger even when the caller forgot to provide a disabled reason", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu contextMode="worktree" targetPath={null} disabledReason={null} />
          </TooltipProvider>
        </QueryProvider>,
      );

      const trigger = screen.getByTestId("agent-studio-git-open-in-trigger");
      if (!(trigger instanceof HTMLButtonElement)) {
        throw new Error("Expected the open-in trigger to be a button");
      }

      expect(trigger.disabled).toBe(true);
      expect(
        screen.getByText(
          "Task worktree path is unavailable. Refresh the Git panel and try again.",
          { selector: "span.sr-only" },
        ).textContent,
      ).toContain("Task worktree path is unavailable");
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("surfaces launch failures with a toast that names the selected tool", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const originalSystemListOpenInTools = host.systemListOpenInTools;
      host.systemListOpenInTools = mock(
        async () =>
          [
            { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
          ] satisfies Array<SystemOpenInToolInfo>,
      );

      try {
        rendered = render(
          <QueryProvider useIsolatedClient>
            <TooltipProvider>
              <OpenInMenu
                contextMode="worktree"
                targetPath="/tmp/worktrees/task-24"
                disabledReason={null}
                onOpenInTool={async () => {
                  throw new Error("launch failed");
                }}
              />
            </TooltipProvider>
          </QueryProvider>,
        );

        await screen.findByTestId("agent-studio-git-open-in-icon-zed");
        await runWithReactAct(async () => {
          fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
          await Promise.resolve();
        });

        expect(saveSettings).not.toHaveBeenCalled();
        expect(toastErrorMock).toHaveBeenCalledWith("Failed to open in Zed", {
          description: "launch failed",
        });
      } finally {
        host.systemListOpenInTools = originalSystemListOpenInTools;
      }
    });
  });

  test("uses the Settings preference as the default action and keeps only alternatives in the menu", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();
    system = { preferredOpenInToolId: "zed" };
    globalThis.localStorage.setItem(storageKey, JSON.stringify({ openInToolId: "terminal" }));
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
          { toolId: "terminal", iconDataUrl: "data:image/png;base64,terminal" },
          { toolId: "zed", iconDataUrl: "data:image/png;base64,zed" },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-zed");
      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "Zed",
      );

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-default-button"));
      });

      expect(onOpenInTool).toHaveBeenCalledWith("zed");

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(screen.queryByTestId("agent-studio-git-open-in-item-zed")).toBeNull();
      expect(screen.getByTestId("agent-studio-git-open-in-item-finder")).toBeTruthy();
      expect(screen.getByTestId("agent-studio-git-open-in-item-terminal")).toBeTruthy();
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("falls back from an absent persisted tool to the first discovered tool without launching", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const storageKey = toRightPanelStorageKey();
    system = { preferredOpenInToolId: "zed" };
    globalThis.localStorage.setItem(storageKey, JSON.stringify({ openInToolId: "terminal" }));
    host.systemListOpenInTools = mock(
      async () =>
        [
          { toolId: "explorer", iconDataUrl: null },
          { toolId: "vscode", iconDataUrl: null },
        ] satisfies Array<SystemOpenInToolInfo>,
    );
    const onOpenInTool = mock(async () => {});

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="repository"
              targetPath="/tmp/repo"
              disabledReason={null}
              onOpenInTool={onOpenInTool}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await screen.findByTestId("agent-studio-git-open-in-icon-explorer");

      expect(screen.getByTestId("agent-studio-git-open-in-default-button").textContent).toContain(
        "File Explorer",
      );
      expect(onOpenInTool).not.toHaveBeenCalled();
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("shows platform-neutral empty discovery copy and disables the default action", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const systemListOpenInTools = mock(async () => [] satisfies Array<SystemOpenInToolInfo>);
    host.systemListOpenInTools = systemListOpenInTools;

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      const defaultButton: HTMLButtonElement = screen.getByTestId(
        "agent-studio-git-open-in-default-button",
      );
      expect(defaultButton.disabled).toBe(true);

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-open-in-trigger"));
      });

      await screen.findByTestId("agent-studio-git-open-in-empty");
      expect(
        screen.getByText("No supported Open In tools were found on this platform."),
      ).toBeTruthy();
      expect(screen.queryByText(/on this Mac/i)).toBeNull();
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("retry forces a fresh discovery request after a discovery error", async () => {
    const originalSystemListOpenInTools = host.systemListOpenInTools;
    const systemListOpenInTools = mock(async (forceRefresh = false) => {
      if (!forceRefresh) {
        throw new Error("initial discovery failed");
      }

      return [
        { toolId: "finder", iconDataUrl: "data:image/png;base64,finder" },
      ] satisfies Array<SystemOpenInToolInfo>;
    });
    host.systemListOpenInTools = systemListOpenInTools;

    try {
      rendered = render(
        <QueryProvider useIsolatedClient>
          <TooltipProvider>
            <OpenInMenu
              contextMode="worktree"
              targetPath="/tmp/worktrees/task-24"
              disabledReason={null}
              onOpenInTool={async () => {}}
            />
          </TooltipProvider>
        </QueryProvider>,
      );

      await runWithReactAct(async () => {
        fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();
      expect(
        screen.getByTestId<HTMLButtonElement>("agent-studio-git-open-in-default-button").disabled,
      ).toBe(true);

      await runWithReactAct(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByTestId("agent-studio-git-open-in-icon-finder")).toBeTruthy();
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(1);
      expect(systemListOpenInTools).toHaveBeenNthCalledWith(2, true);
    } finally {
      host.systemListOpenInTools = originalSystemListOpenInTools;
    }
  });

  test("retry surfaces a toast when refresh discovery also fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const originalSystemListOpenInTools = host.systemListOpenInTools;
      const systemListOpenInTools = mock(async () => {
        throw new Error("refresh discovery failed");
      });
      host.systemListOpenInTools = systemListOpenInTools;

      try {
        rendered = render(
          <QueryProvider useIsolatedClient>
            <TooltipProvider>
              <OpenInMenu
                contextMode="worktree"
                targetPath="/tmp/worktrees/task-24"
                disabledReason={null}
                onOpenInTool={async () => {}}
              />
            </TooltipProvider>
          </QueryProvider>,
        );

        await runWithReactAct(async () => {
          fireEvent.click(await screen.findByTestId("agent-studio-git-open-in-trigger"));
        });

        expect(await screen.findByTestId("agent-studio-git-open-in-error")).toBeTruthy();

        await runWithReactAct(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Retry" }));
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(toastErrorMock).toHaveBeenCalledWith("Failed to refresh supported apps", {
          description: "refresh discovery failed",
        });
      } finally {
        host.systemListOpenInTools = originalSystemListOpenInTools;
      }
    });
  });
});
