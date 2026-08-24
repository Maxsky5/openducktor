import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentRuntimes,
  DEFAULT_AGENT_RUNTIMES,
  type RuntimeExecutableCheck,
  type RuntimeKind,
} from "@openducktor/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { host } from "@/state/operations/host";
import { runtimeDiscoveryQueryOptions } from "@/state/queries/runtime";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  createCheck,
  createOnboardingTestHarness,
  enterRuntimeStage,
  opencodeSection,
  runtimeDefinitions,
} from "./onboarding-page.test-support";

const { cleanup, renderOnboarding } = createOnboardingTestHarness();
afterEach(cleanup);

describe("useOnboardingRuntimeSetup", () => {
  test("keeps runtime cards neutral while exact paths are being checked", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        enabled: true,
        executablePath: "/valid/codex",
      },
      claude: {
        ...DEFAULT_AGENT_RUNTIMES.claude,
        enabled: true,
        executablePath: "/valid/claude",
      },
    };
    const validation = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => validation.promise);

    try {
      renderOnboarding({ runtimes });
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
      );

      await screen.findByRole("heading", { name: "Configure coding agents" });
      expect(screen.getAllByText("Checking")).toHaveLength(runtimeDefinitions.length);
      expect(screen.queryByText("Unavailable")).toBeNull();
      expect(screen.queryByText("Enter a path, then check it.")).toBeNull();
      expect(screen.getAllByText("Validating saved executable path...")).toHaveLength(
        runtimeDefinitions.length,
      );
      for (const input of screen.getAllByRole("textbox", { name: "Executable path" })) {
        expect(input.getAttribute("aria-invalid")).toBe("false");
      }

      await act(async () => {
        validation.resolve(createCheck(runtimes, true));
      });
      await within(opencodeSection()).findByText("Available");
      expect(within(opencodeSection()).getByText("1.0.0")).toBeTruthy();
      expect(within(opencodeSection()).queryByText("1.0.0 at /valid/opencode")).toBeNull();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("uses runtime brand marks and opens Browse in the configured executable directory", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/Users/dev/.local/bin/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const original = {
      filesystemListDirectory: host.filesystemListDirectory,
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
    };
    const filesystemListDirectory = mock(async () => ({
      currentPath: "/Users/dev/.local/bin",
      currentPathIsGitRepo: false,
      parentPath: "/Users/dev/.local",
      homePath: "/Users/dev",
      entries: [],
    }));
    host.filesystemListDirectory = filesystemListDirectory;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();

      for (const definition of runtimeDefinitions) {
        const section = screen.getByRole("heading", { name: definition.label }).closest("section");
        if (!section) throw new Error(`${definition.label} section is missing`);
        const logo = section.querySelector<HTMLElement>(`[data-runtime-logo="${definition.kind}"]`);
        expect(logo?.querySelector("svg")).toBeTruthy();
        expect(logo?.className).not.toMatch(/\b(?:bg-|border|rounded)/);
      }
      expect(opencodeSection().textContent).not.toContain("OC");

      await act(async () => {
        fireEvent.click(
          within(opencodeSection()).getByRole<HTMLButtonElement>("button", { name: "Browse" }),
        );
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(filesystemListDirectory).toHaveBeenCalledWith({
          path: "/Users/dev/.local/bin",
          includeFiles: true,
        }),
      );
      await screen.findByText("/Users/dev/.local/bin");
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }));
    } finally {
      host.filesystemListDirectory = original.filesystemListDirectory;
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
    }
  });

  test("shows and retries a settings snapshot failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    host.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    host.workspaceGetSettingsSnapshot = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Settings snapshot failed");
      return snapshot;
    });

    try {
      renderOnboarding({ runtimes, prefillSettings: false, prefillDefinitions: false });
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await screen.findByText("Settings snapshot failed");
      expect(screen.queryByLabelText("Loading coding agent settings")).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(attempts).toBe(2));
      await screen.findByRole("heading", { name: "OpenCode" });
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("shows and retries a runtime definition failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    host.workspaceGetSettingsSnapshot = mock(async () => snapshot);
    host.runtimeDefinitionsList = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Runtime definitions failed");
      return runtimeDefinitions;
    });

    try {
      renderOnboarding({ runtimes, prefillSettings: false, prefillDefinitions: false });
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await screen.findByText("Runtime definitions failed");
      await act(async () => {
        fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(attempts).toBe(2));
      await screen.findByRole("heading", { name: "OpenCode" });
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("keeps runtime controls available after a runtime validation request fails", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    const original = {
      runtimeExecutablesCheck: host.runtimeExecutablesCheck,
      runtimeDefinitionsList: host.runtimeDefinitionsList,
      workspaceGetSettingsSnapshot: host.workspaceGetSettingsSnapshot,
    };
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && Object.hasOwn(input.paths, "opencode")) {
        throw new Error("Runtime validation failed");
      }
      return createCheck(runtimes, true);
    });
    host.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    host.workspaceGetSettingsSnapshot = mock(async () => snapshot);

    try {
      renderOnboarding({ runtimes });
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
        );
        await Promise.resolve();
      });
      await screen.findByText("Runtime validation failed");
      expect(screen.queryByText("Coding agent setup could not load")).toBeNull();
      expect(
        within(opencodeSection()).getByRole<HTMLInputElement>("textbox", {
          name: "Executable path",
        }).disabled,
      ).toBe(false);
      expect(
        within(opencodeSection()).getByRole<HTMLButtonElement>("switch", { name: "Enabled" })
          .disabled,
      ).toBe(false);
    } finally {
      host.runtimeExecutablesCheck = original.runtimeExecutablesCheck;
      host.runtimeDefinitionsList = original.runtimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = original.workspaceGetSettingsSnapshot;
    }
  });

  test("waits for an active runtime validation before checking the latest edited path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/initial/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const initialValidation = createDeferred<RuntimeExecutableCheck>();
    const latestValidation = createDeferred<RuntimeExecutableCheck>();
    const opencodePaths: string[] = [];
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes, true);
      const opencodePath = input.paths.opencode;
      if (opencodePath !== undefined) {
        opencodePaths.push(opencodePath);
        if (opencodePath === "/initial/opencode") return initialValidation.promise;
        return latestValidation.promise;
      }
      return createCheck(runtimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(opencodePaths).toEqual(["/initial/opencode"]));

      const input = within(opencodeSection()).getByRole("textbox", { name: "Executable path" });
      await act(async () => {
        fireEvent.change(input, { target: { value: "/intermediate/opencode" } });
        fireEvent.change(input, { target: { value: "/latest/opencode" } });
        await Promise.resolve();
      });
      expect(opencodePaths).toEqual(["/initial/opencode"]);

      await act(async () => {
        initialValidation.resolve({
          runtimes: [
            {
              kind: "opencode",
              path: "/initial/opencode",
              ok: true,
              version: "1.0.0",
              error: null,
            },
          ],
        });
        await Promise.resolve();
      });

      await waitFor(() => expect(opencodePaths).toEqual(["/initial/opencode", "/latest/opencode"]));
      expect(opencodePaths).not.toContain("/intermediate/opencode");
      await act(async () => {
        latestValidation.resolve({
          runtimes: [
            {
              kind: "opencode",
              path: "/latest/opencode",
              ok: true,
              version: "1.0.0",
              error: null,
            },
          ],
        });
        await Promise.resolve();
      });
      await within(opencodeSection()).findByText("Available");
    } finally {
      initialValidation.resolve(createCheck(runtimes, true));
      latestValidation.resolve(createCheck(runtimes, true));
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("does not block onboarding when validation fails for a disabled runtime", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "/broken/claude" },
    };
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && Object.hasOwn(input.paths, "claude")) {
        throw new Error("Disabled Claude validation failed");
      }
      return createCheck(runtimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
      expect(screen.queryByText("Disabled Claude validation failed")).toBeNull();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("checks an edited enabled runtime while a disabled runtime validation is pending", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "/slow/claude" },
    };
    const claudeValidation = createDeferred<RuntimeExecutableCheck>();
    const opencodePaths: string[] = [];
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && Object.hasOwn(input.paths, "claude")) {
        return claudeValidation.promise;
      }
      if (input.mode === "validate" && input.paths.opencode !== undefined) {
        opencodePaths.push(input.paths.opencode);
        return {
          runtimes: [
            {
              kind: "opencode",
              path: input.paths.opencode,
              ok: true,
              version: "1.0.0",
              error: null,
            },
          ],
        } satisfies RuntimeExecutableCheck;
      }
      return createCheck(runtimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
      fireEvent.change(
        within(opencodeSection()).getByRole("textbox", { name: "Executable path" }),
        { target: { value: "/updated/opencode" } },
      );
      await waitFor(() => expect(opencodePaths).toContain("/updated/opencode"));
    } finally {
      claudeValidation.resolve(createCheck(runtimes, true));
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps Continue available after an optional runtime rediscovery fails", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const saveSettingsSnapshot = mock(async () => {});
    let discoveryAttempts = 0;
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") {
        discoveryAttempts += 1;
        if (discoveryAttempts === 1) throw new Error("Runtime discovery failed");
      }
      return createCheck(runtimes, true);
    });

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
        );
      });
      await screen.findByText("Runtime discovery failed");

      expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
        false,
      );
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("runs explicit runtime discovery through the shared Query cache", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discovery = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") return discovery.promise;
      return createCheck(runtimes, true);
    });

    try {
      const queryClient = renderOnboarding({ runtimes });
      await enterRuntimeStage();

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
      );
      await waitFor(() =>
        expect(
          queryClient.getQueryState(runtimeDiscoveryQueryOptions().queryKey)?.fetchStatus,
        ).toBe("fetching"),
      );

      await act(async () => {
        discovery.resolve(createCheck(runtimes, true));
      });
      await waitFor(() =>
        expect(queryClient.getQueryState(runtimeDiscoveryQueryOptions().queryKey)?.status).toBe(
          "success",
        ),
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("locks runtime edits and navigation while explicit discovery is pending", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discoveredRuntimes: AgentRuntimes = {
      ...runtimes,
      opencode: { enabled: true, executablePath: "/discovered/opencode" },
    };
    const discovery = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") return discovery.promise;
      const checkedRuntimes = {
        ...runtimes,
        opencode: { ...runtimes.opencode, executablePath: input.paths.opencode },
      };
      return createCheck(checkedRuntimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();

      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
      );
      await screen.findByRole("button", { name: "Scanning..." });

      const pathInput = screen.getByLabelText<HTMLInputElement>("Executable path", {
        selector: "#runtime-executable-opencode",
      });
      const enabledSwitch = within(opencodeSection()).getByRole<HTMLButtonElement>("switch", {
        name: "Enabled",
      });
      const browseButton = within(opencodeSection()).getByRole<HTMLButtonElement>("button", {
        name: "Browse",
      });
      const backButton = screen.getByRole<HTMLButtonElement>("button", { name: "Back" });

      expect(pathInput.disabled).toBe(true);
      expect(enabledSwitch.disabled).toBe(true);
      expect(browseButton.disabled).toBe(true);
      expect(backButton.disabled).toBe(true);
      pathInput.focus();
      fireEvent.keyDown(pathInput, { key: "x" });
      enabledSwitch.click();
      expect(pathInput.value).toBe("/valid/opencode");
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("true");

      await act(async () => discovery.resolve(createCheck(discoveredRuntimes, true)));
      await waitFor(() => expect(pathInput.value).toBe("/discovered/opencode"));
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("publishes exact-path results returned by explicit runtime discovery", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const discoveredRuntimes: AgentRuntimes = {
      ...runtimes,
      opencode: { enabled: true, executablePath: "/discovered/opencode" },
    };
    const requests: Array<"discover" | { opencodePath: string }> = [];
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") {
        requests.push("discover");
        return createCheck(discoveredRuntimes, true);
      }
      requests.push({ opencodePath: input.paths.opencode });
      const checkedRuntimes = {
        ...runtimes,
        opencode: { enabled: true, executablePath: input.paths.opencode },
      };
      return createCheck(checkedRuntimes, true);
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      requests.length = 0;

      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
        );
      });

      await waitFor(() => expect(requests).toEqual(["discover"]));
      expect(
        screen.getByLabelText<HTMLInputElement>("Executable path", {
          selector: "#runtime-executable-opencode",
        }).value,
      ).toBe("/discovered/opencode");
      await within(opencodeSection()).findByText("Available");
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("shows fresh discovery status when a runtime changes at the same path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/tools/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) =>
      input.mode === "discover" ? createCheck(runtimes, true) : createCheck(runtimes, false),
    );

    try {
      renderOnboarding({ runtimes });
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
        );
      });

      await screen.findByRole("heading", { name: "Configure coding agents" });
      await within(opencodeSection()).findByText("Needs attention");
      await act(async () => {
        fireEvent.click(
          screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
        );
      });

      await within(opencodeSection()).findByText("Available");
      expect(within(opencodeSection()).getByText("1.0.0")).toBeTruthy();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("blocks Continue while a changed path is being checked and rejects the new invalid path", async () => {
    const initialRuntimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const invalidCheck = createDeferred<RuntimeExecutableCheck>();
    const runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && input.paths.opencode === "/invalid/opencode") {
        return invalidCheck.promise;
      }
      return createCheck(initialRuntimes, true);
    });
    const saveSettingsSnapshot = mock(async () => {});
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = runtimeExecutablesCheck;

    try {
      renderOnboarding({ runtimes: initialRuntimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      await within(opencodeSection()).findByText("Available");

      fireEvent.change(
        screen.getByLabelText<HTMLInputElement>("Executable path", {
          selector: "#runtime-executable-opencode",
        }),
        {
          target: { value: "/invalid/opencode" },
        },
      );

      expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
        true,
      );
      expect(within(opencodeSection()).queryByText("Available")).toBeNull();
      await act(async () => {
        invalidCheck.resolve(
          createCheck(
            {
              ...initialRuntimes,
              opencode: { enabled: true, executablePath: "/invalid/opencode" },
            },
            false,
          ),
        );
      });
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));

      expect(screen.getAllByText("OpenCode executable is invalid.").length).toBeGreaterThan(0);
      expect(saveSettingsSnapshot).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(
        screen.getByLabelText<HTMLInputElement>("Executable path", {
          selector: "#runtime-executable-opencode",
        }),
      );
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("checks only the runtime whose executable path changed", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true, executablePath: "/valid/codex" },
      claude: { enabled: true, executablePath: "/valid/claude" },
    };
    const requests: RuntimeKind[][] = [];
    const changedCheck = createDeferred<RuntimeExecutableCheck>();
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes, true);
      const kinds = runtimeDefinitions
        .map((definition) => definition.kind)
        .filter((kind) => kind in input.paths);
      requests.push(kinds);
      if (input.paths.opencode === "/changed/opencode") return changedCheck.promise;
      return {
        runtimes: kinds.map((kind) => ({
          kind,
          path: input.paths[kind] ?? "",
          ok: true,
          version: `${kind} 1.0.0`,
          error: null,
        })),
      };
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      requests.length = 0;

      fireEvent.change(
        screen.getByLabelText<HTMLInputElement>("Executable path", {
          selector: "#runtime-executable-opencode",
        }),
        { target: { value: "/changed/opencode" } },
      );

      await within(opencodeSection()).findByText("Checking");
      expect(requests).toEqual([["opencode"]]);
      const codexSection = screen.getByRole("heading", { name: "Codex" }).closest("section");
      if (!codexSection) throw new Error("Codex section is missing");
      expect(within(codexSection).queryByText("Checking")).toBeNull();

      await act(async () => {
        changedCheck.resolve({
          runtimes: [
            {
              kind: "opencode",
              path: "/changed/opencode",
              ok: true,
              version: "opencode 1.0.0",
              error: null,
            },
          ],
        });
      });
      await within(opencodeSection()).findByText("opencode 1.0.0");
      expect(within(opencodeSection()).queryByText(/\/changed\/opencode/)).toBeNull();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("auto-enables a valid custom path unless the user changed the switch", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes);
      const kinds = runtimeDefinitions
        .map((definition) => definition.kind)
        .filter((kind) => kind in input.paths);
      return {
        runtimes: kinds.map((kind) => {
          const path = input.paths[kind] ?? "";
          const ok = kind === "opencode" && path.startsWith("/custom/");
          return {
            kind,
            path,
            ok,
            version: ok ? "1.0.0" : null,
            error: ok ? null : `${kind} executable is invalid.`,
          };
        }),
      };
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      const pathInput = screen.getByLabelText<HTMLInputElement>("Executable path", {
        selector: "#runtime-executable-opencode",
      });
      const enabledSwitch = within(opencodeSection()).getByRole<HTMLButtonElement>("switch", {
        name: "Enabled",
      });

      fireEvent.change(pathInput, { target: { value: "/custom/opencode" } });
      await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("true"));
      fireEvent.click(enabledSwitch);
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
      fireEvent.change(pathInput, { target: { value: "/custom/opencode-v2" } });
      await within(opencodeSection()).findByText("1.0.0");
      expect(within(opencodeSection()).queryByText(/\/custom\/opencode-v2/)).toBeNull();
      expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("preserves the user-entered path when validation resolves another executable path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode !== "validate") return createCheck(runtimes);
      const kinds = runtimeDefinitions
        .map((definition) => definition.kind)
        .filter((kind) => kind in input.paths);
      return {
        runtimes: kinds.map((kind) => {
          const requestedPath = input.paths[kind] ?? "";
          const ok = kind === "opencode" && requestedPath === "~/.local/bin/opencode";
          return {
            kind,
            path: ok ? "/Users/dev/.local/bin/opencode" : requestedPath,
            ok,
            version: ok ? "1.0.0" : null,
            error: ok ? null : `${kind} executable is invalid.`,
          };
        }),
      };
    });

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      const pathInput = screen.getByLabelText<HTMLInputElement>("Executable path", {
        selector: "#runtime-executable-opencode",
      });

      fireEvent.change(pathInput, { target: { value: "~/.local/bin/opencode" } });

      await within(opencodeSection()).findByText("1.0.0");
      expect(pathInput.value).toBe("~/.local/bin/opencode");
      expect(
        within(opencodeSection())
          .getByRole<HTMLButtonElement>("switch", { name: "Enabled" })
          .getAttribute("aria-checked"),
      ).toBe("true");
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps the runtime step on save failure and supports retry, Workspace, and Back", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "" },
    };
    let saveCalls = 0;
    const saveSettingsSnapshot = mock(async () => {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error("Settings write failed");
    });
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      expect(screen.queryByText("Agent tools")).toBeNull();
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Continue without a coding agent" }),
      );
      const saveError = await screen.findByText("Settings write failed");
      expect(screen.getByText("Configure coding agents")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Continue without a coding agent?" })).toBeNull();
      expect(document.activeElement).toBe(saveError);

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Continue without a coding agent" }),
      );
      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(screen.queryByText("Repository boundary")).toBeNull();
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Back/ }));
      expect(screen.getByRole("heading", { name: "Configure coding agents" })).toBeTruthy();
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps the coding-agent form visually stable while save is pending", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { enabled: true, executablePath: "/valid/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true, executablePath: "/valid/codex" },
      claude: { enabled: true, executablePath: "/valid/claude" },
    };
    const availableCheck: RuntimeExecutableCheck = {
      runtimes: runtimeDefinitions.map(({ kind }) => ({
        kind,
        path: runtimes[kind].executablePath,
        ok: true,
        version: `${kind} 1.0.0`,
        error: null,
      })),
    };
    const save = createDeferred<void>();
    const saveSettingsSnapshot = mock(async () => save.promise);
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => availableCheck);

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      await waitFor(() => expect(screen.getAllByText("Available")).toHaveLength(3));

      const heading = screen.getByRole("heading", { name: "Configure coding agents" });
      const stage = heading.closest('[data-slot="card"]');
      const pathInput = screen.getByLabelText<HTMLInputElement>("Executable path", {
        selector: "#runtime-executable-opencode",
      });
      const enabledSwitch = within(opencodeSection()).getByRole<HTMLButtonElement>("switch", {
        name: "Enabled",
      });
      const scanButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Scan for coding agents",
      });
      const continueButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Continue to workspace",
      });

      await act(async () => {
        fireEvent.click(continueButton);
        await Promise.resolve();
      });
      await waitFor(() => expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1));

      expect(stage?.hasAttribute("inert")).toBe(true);
      expect(stage?.textContent?.match(/Available/g)).toHaveLength(3);
      expect(stage?.textContent).not.toContain("Checking");
      expect(pathInput.disabled).toBe(false);
      expect(enabledSwitch.disabled).toBe(false);
      expect(scanButton.disabled).toBe(false);
      expect(continueButton.disabled).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Saving coding agents..." }),
      ).toBe(continueButton);

      await act(async () => save.resolve());
      await screen.findByRole("heading", { name: "Open your first workspace" });
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("submits the no-runtime confirmation only once while saving", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const save = createDeferred<void>();
    const saveSettingsSnapshot = mock(async () => save.promise);
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterRuntimeStage();
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

      const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
        name: "Continue without a coding agent",
      });
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving..." }).disabled).toBe(
        true,
      );
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(true);

      await act(async () => save.resolve());
      await screen.findByRole("heading", { name: "Open your first workspace" });
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps the no-runtime warning visible after confirmation is cancelled", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    try {
      renderOnboarding({ runtimes });
      await enterRuntimeStage();
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
      await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "Continue without a coding agent?" })).toBeNull();
      expect(
        screen.getByText(
          "Agent sessions will not work until you configure and enable a valid coding agent in Settings.",
        ),
      ).toBeTruthy();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });
});
