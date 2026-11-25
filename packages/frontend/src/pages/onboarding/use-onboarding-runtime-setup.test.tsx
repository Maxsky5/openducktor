import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentRuntimes,
  DEFAULT_AGENT_RUNTIMES,
  type RuntimeExecutableCheck,
  type RuntimeKind,
} from "@openducktor/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { HostClient } from "@openducktor/host-client";
import {
  runtimeDiscoveryQueryOptions,
  runtimeQueryKeys,
} from "@openducktor/frontend-core/queries/runtime";
import { filesystemQueryKeys } from "@openducktor/frontend-core/queries/filesystem";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  createCheck,
  createOnboardingTestHarness,
  continueFromNotificationsToWorkspace,
  enterRuntimeStage,
  opencodeSection,
  runtimeDefinitions,
  runtimeSection,
} from "./onboarding-page.test-support";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";

const { cleanup, renderOnboarding } = createOnboardingTestHarness();
afterEach(cleanup);

describe("useOnboardingRuntimeSetup", () => {
  test("keeps runtime cards neutral while exact paths are being checked", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
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
      antigravity: {
        enabled: true,
        executablePath: "/valid/agy",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const validation = Promise.withResolvers<RuntimeExecutableCheck>();
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => validation.promise);

    renderOnboarding({ client, runtimes });
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
    );

    await screen.findByRole("heading", { name: "Configure coding agents" });
    expect(screen.getAllByText("Checking")).toHaveLength(runtimeDefinitions.length);
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.queryByText("Enter a path, then check it.")).toBeNull();
    expect(screen.getAllByText("Checking executable path…")).toHaveLength(
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
  });

  test("uses runtime brand marks and opens Browse in the configured executable directory", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/Users/dev/.local/bin/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const queryClient = renderOnboarding({
      client: { runtimeExecutablesCheck: async () => createCheck(runtimes, true) },
      runtimes,
    });
    await enterRuntimeStage();

    for (const definition of runtimeDefinitions) {
      const section = screen.getByRole("heading", { name: definition.label }).closest("section");
      if (!section) throw new Error(`${definition.label} section is missing`);
      const logo = section.querySelector<HTMLElement>(`[data-runtime-logo="${definition.kind}"]`);
      expect(logo?.querySelector("svg")).toBeTruthy();
      expect(logo?.className).not.toMatch(/\b(?:bg-|border|rounded)/);
    }
    expect(opencodeSection().textContent).not.toContain("OC");

    const directory = "/Users/dev/.local/bin";
    queryClient.setQueryData(filesystemQueryKeys.directory(directory, true), {
      currentPath: directory,
      currentPathIsGitRepo: false,
      parentPath: "/Users/dev/.local",
      homePath: "/Users/dev",
      entries: [
        {
          name: "opencode",
          path: `${directory}/opencode`,
          isDirectory: false,
          isGitRepo: false,
        },
      ],
    });
    fireEvent.click(within(opencodeSection()).getByRole("button", { name: "Browse" }));
    const picker = within(screen.getByRole("dialog", { name: "Choose coding agent executable" }));
    expect(picker.getByText(directory)).toBeTruthy();
    expect(picker.getByRole("button", { name: "opencode" })).toBeTruthy();
    await act(async () => fireEvent.click(picker.getByRole("button", { name: "Cancel" })));
  });

  test("shows and retries a settings snapshot failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    client.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    client.workspaceGetSettingsSnapshot = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Settings snapshot failed");
      return snapshot;
    });

    renderOnboarding({ client, runtimes, prefillSettings: false, prefillDefinitions: false });
    await act(async () => {
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
      );
    });

    await screen.findByText("Settings snapshot failed");
    expect(screen.queryByLabelText("Loading coding agent settings")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }));
    });

    await waitFor(() => expect(attempts).toBe(2));
    await screen.findByRole("heading", { name: "OpenCode" });
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
        false,
      ),
    );
  });

  test("shows and retries a runtime definition failure before a draft exists", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    let attempts = 0;
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));
    client.workspaceGetSettingsSnapshot = mock(async () => snapshot);
    client.runtimeDefinitionsList = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Runtime definitions failed");
      return runtimeDefinitions;
    });

    renderOnboarding({ client, runtimes, prefillSettings: false, prefillDefinitions: false });
    await act(async () => {
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
      );
    });

    await screen.findByText("Runtime definitions failed");
    await act(async () => {
      fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }));
    });

    await waitFor(() => expect(attempts).toBe(2));
    await screen.findByRole("heading", { name: "OpenCode" });
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(
        false,
      ),
    );
  });

  test("keeps runtime controls available after a runtime validation request fails", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const snapshot = createSettingsSnapshotFixture({ agentRuntimes: runtimes });
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && Object.hasOwn(input.paths, "opencode")) {
        throw new Error("Runtime validation failed");
      }
      return createCheck(runtimes, true);
    });
    client.runtimeDefinitionsList = mock(async () => runtimeDefinitions);
    client.workspaceGetSettingsSnapshot = mock(async () => snapshot);

    renderOnboarding({ client, runtimes });
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
  });

  test("waits for an active runtime validation before checking the latest edited path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/initial/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const initialValidation = Promise.withResolvers<RuntimeExecutableCheck>();
    const latestValidation = Promise.withResolvers<RuntimeExecutableCheck>();
    const opencodePaths: string[] = [];
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
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
      renderOnboarding({ client, runtimes });
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
    }
    // This flow renders runtime setup and waits for validation updates.
  }, 2_500);

  test("keeps an enabled runtime usable while a disabled runtime check is pending and after it fails", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "/slow/claude", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const claudeValidation = Promise.withResolvers<RuntimeExecutableCheck>();
    const opencodePaths: string[] = [];
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
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
      const queryClient = renderOnboarding({ client, runtimes });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" })),
      );
      const opencode = within(opencodeSection());
      await opencode.findByText("Available");
      const continueButton = screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ });
      const claudeCheck = runtimeQueryKeys.executable("claude", runtimes.claude.executablePath);

      expect(continueButton.disabled).toBe(false);
      expect(queryClient.getQueryState(claudeCheck)?.fetchStatus).toBe("fetching");
      await act(async () => {
        fireEvent.change(opencode.getByRole("textbox", { name: "Executable path" }), {
          target: { value: "/updated/opencode" },
        });
      });
      expect(opencodePaths).toEqual(["/valid/opencode", "/updated/opencode"]);
      await opencode.findByText("Available");

      const failure = new Error("Disabled Claude validation failed");
      await act(async () => claudeValidation.reject(failure));
      expect(queryClient.getQueryState(claudeCheck)?.error).toBe(failure);
      expect(continueButton.disabled).toBe(false);
      expect(screen.queryByText(failure.message)).toBeNull();
    } finally {
      claudeValidation.resolve(createCheck(runtimes, true));
    }
  });

  test("keeps Continue available after an optional runtime rediscovery fails", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    let discoveryAttempts = 0;
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "discover") {
        discoveryAttempts += 1;
        if (discoveryAttempts === 1) throw new Error("Runtime discovery failed");
      }
      return createCheck(runtimes, true);
    });

    renderOnboarding({ client, runtimes, saveSettingsSnapshot });
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    });
    await continueFromNotificationsToWorkspace();
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    // This flow renders runtime setup and waits for validation updates.
  }, 2_500);

  test("locks runtime edits during discovery and applies the cached result for the new path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const discovered = createCheck(
      {
        ...runtimes,
        opencode: { ...runtimes.opencode, executablePath: "/discovered/opencode" },
      },
      true,
    );
    const discovery = Promise.withResolvers<RuntimeExecutableCheck>();
    const check = mock<HostClient["runtimeExecutablesCheck"]>(async (input) => {
      if (input.mode === "discover") return discovery.promise;
      const checkedRuntimes = {
        ...runtimes,
        opencode: {
          ...runtimes.opencode,
          executablePath: input.paths.opencode ?? runtimes.opencode.executablePath,
        },
      };
      return createCheck(checkedRuntimes, true);
    });

    const queryClient = renderOnboarding({ client: { runtimeExecutablesCheck: check }, runtimes });
    const queryKey = runtimeDiscoveryQueryOptions().queryKey;
    try {
      await enterRuntimeStage();
      const opencode = within(opencodeSection());
      await opencode.findByText("Available");
      check.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Scan for coding agents" }));
      });
      expect(screen.getByRole("button", { name: "Scanning..." })).toHaveProperty("disabled", true);
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("fetching");

      const pathInput = opencode.getByRole<HTMLInputElement>("textbox", {
        name: "Executable path",
      });
      const enabled = opencode.getByRole("switch", { name: "Enabled" });
      expect(pathInput.disabled).toBe(true);
      expect(enabled).toHaveProperty("disabled", true);
      expect(opencode.getByRole("button", { name: "Browse" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: /Continue/ })).toHaveProperty("disabled", true);

      await act(async () => discovery.resolve(discovered));
      expect(queryClient.getQueryData(queryKey)).toEqual(discovered);
      expect(pathInput.value).toBe("/discovered/opencode");
      expect(pathInput.disabled).toBe(false);
      expect(opencode.getByText("Available")).toBeTruthy();
      expect(check.mock.calls.map(([request]) => request.mode)).toEqual(["discover"]);
    } finally {
      discovery.resolve(discovered);
    }
  });

  test("fills the Antigravity path from discovery but leaves the runtime off", async () => {
    const runtimes = structuredClone(DEFAULT_AGENT_RUNTIMES);
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
      const check = createCheck(runtimes, true);
      if (input.mode !== "discover") return check;
      return {
        runtimes: check.runtimes.map((row) =>
          row.kind === "antigravity"
            ? { ...row, path: "/found/agy", ok: true, version: "1.5.14", error: null }
            : row,
        ),
      };
    });

    renderOnboarding({ client, runtimes });
    await enterRuntimeStage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Scan for coding agents" }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLInputElement>("Executable path", {
          selector: "#runtime-executable-antigravity",
        }).value,
      ).toBe("/found/agy"),
    );
    expect(
      within(runtimeSection("Antigravity"))
        .getByRole<HTMLButtonElement>("switch", { name: "Enabled" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      within(opencodeSection())
        .getByRole<HTMLButtonElement>("switch", { name: "Enabled" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("shows fresh discovery status when a runtime changes at the same path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/tools/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) =>
      input.mode === "discover" ? createCheck(runtimes, true) : createCheck(runtimes, false),
    );

    renderOnboarding({ client, runtimes });
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
  });

  test("shows the update steps and found version of an incompatible runtime", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/tools/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const error =
      "OpenCode at '/tools/opencode' is not compatible with OpenDucktor. OpenDucktor needs OpenCode 2 or later. Run `opencode upgrade`, or select another OpenCode executable. Then try again.";
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => {
      const check = createCheck(runtimes);
      return {
        runtimes: check.runtimes.map((row) =>
          row.kind === "opencode" ? { ...row, version: "1.0.0", error } : row,
        ),
      };
    });

    renderOnboarding({ client, runtimes });
    await act(async () => {
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
      );
    });

    await within(opencodeSection()).findByText("Needs attention");
    const status = document.getElementById("runtime-executable-opencode-status");
    expect(status?.textContent).toContain(error.replaceAll("`", ""));
    expect(within(opencodeSection()).getByText("opencode upgrade").tagName).toBe("CODE");
    expect(within(opencodeSection()).getByText("Found version: 1.0.0")).toBeTruthy();
  });

  test("shows a disabled runtime that fails its check as unavailable, not missing", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: false,
        executablePath: "/tools/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    renderOnboarding({ client, runtimes });
    await act(async () => {
      fireEvent.click(
        screen.getByRole<HTMLButtonElement>("button", { name: "Configure coding agents" }),
      );
    });

    await within(opencodeSection()).findByText("Unavailable");
    expect(within(opencodeSection()).queryByText("Not found")).toBeNull();
  });

  test("blocks Continue while a changed path is being checked and rejects the new invalid path", async () => {
    const initialRuntimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const invalidCheck = Promise.withResolvers<RuntimeExecutableCheck>();
    const runtimeExecutablesCheck = mock(async (input) => {
      if (input.mode === "validate" && input.paths.opencode === "/invalid/opencode") {
        return invalidCheck.promise;
      }
      return createCheck(initialRuntimes, true);
    });
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = runtimeExecutablesCheck;

    renderOnboarding({ client, runtimes: initialRuntimes, saveSettingsSnapshot });
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

    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }).disabled).toBe(true);
    expect(within(opencodeSection()).queryByText("Available")).toBeNull();
    await act(async () => {
      invalidCheck.resolve(
        createCheck(
          {
            ...initialRuntimes,
            opencode: {
              defaults: { rules: [] },
              roleOverrides: {},
              enabled: true,
              executablePath: "/invalid/opencode",
            },
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
  });

  test("checks only the runtime whose executable path changed", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true, executablePath: "/valid/codex" },
      claude: { enabled: true, executablePath: "/valid/claude", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const requests: RuntimeKind[][] = [];
    const changedCheck = Promise.withResolvers<RuntimeExecutableCheck>();
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
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

    renderOnboarding({ client, runtimes });
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
  });

  test("auto-enables a valid custom path unless the user changed the switch", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { defaults: { rules: [] }, roleOverrides: {}, enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
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

    renderOnboarding({ client, runtimes });
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
  });

  test("preserves the user-entered path when validation resolves another executable path", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { defaults: { rules: [] }, roleOverrides: {}, enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async (input) => {
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

    renderOnboarding({ client, runtimes });
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
  });

  // This test renders and visits three onboarding stages before it checks Back navigation.
  test("keeps the runtime step on save failure and supports retry, Workspace, and Back", async () => {
    const runtimes: AgentRuntimes = {
      opencode: { defaults: { rules: [] }, roleOverrides: {}, enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false, executablePath: "" },
      claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
    };
    let saveCalls = 0;
    const saveSettingsSnapshot = mock(async () => {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error("Settings write failed");
      return savedSettingsResult();
    });
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    renderOnboarding({ client, runtimes, saveSettingsSnapshot });
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue without a coding agent" }));
    });
    await continueFromNotificationsToWorkspace();
    expect(screen.queryByText("Repository boundary")).toBeNull();
    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Back/ }));
    await screen.findByRole("heading", { name: "Configure notifications" });
    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "Configure coding agents" })).toBeTruthy();
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2);
    // This test renders a failed save, a retry, and two stage changes.
  }, 5_000);

  // This test renders the full coding-agent form and waits for an async save.
  test("keeps the coding-agent form visually stable while save is pending", async () => {
    const runtimes: AgentRuntimes = {
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/valid/opencode",
      },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true, executablePath: "/valid/codex" },
      claude: { enabled: true, executablePath: "/valid/claude", defaults: {}, roleOverrides: {} },
      antigravity: {
        enabled: false,
        executablePath: "",
        defaults: { mode: "auto" },
        roleOverrides: {},
      },
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
    const save = Promise.withResolvers<void>();
    const saveSettingsSnapshot = mock(async () => {
      await save.promise;
      return savedSettingsResult();
    });
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => availableCheck);

    renderOnboarding({ client, runtimes, saveSettingsSnapshot });
    await enterRuntimeStage();
    await waitFor(() =>
      expect(screen.getAllByText("Available")).toHaveLength(runtimeDefinitions.length),
    );

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
      name: "Continue to notifications",
    });

    await act(async () => {
      fireEvent.click(continueButton);
      await Promise.resolve();
    });
    await waitFor(() => expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1));

    expect(stage?.hasAttribute("inert")).toBe(true);
    expect(stage?.textContent?.match(/Available/g)).toHaveLength(runtimeDefinitions.length);
    expect(stage?.textContent).not.toContain("Checking");
    expect(pathInput.disabled).toBe(false);
    expect(enabledSwitch.disabled).toBe(false);
    expect(scanButton.disabled).toBe(false);
    expect(continueButton.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving coding agents..." })).toBe(
      continueButton,
    );

    await act(async () => save.resolve());
    await continueFromNotificationsToWorkspace();
    // This test keeps three runtime cards mounted during a pending save.
  }, 5_000);

  test("submits the no-runtime confirmation only once while saving", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const save = Promise.withResolvers<void>();
    const saveSettingsSnapshot = mock(async () => {
      await save.promise;
      return savedSettingsResult();
    });
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    renderOnboarding({ client, runtimes, saveSettingsSnapshot });
    await enterRuntimeStage();
    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
    await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

    const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Continue without a coding agent",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(true);

    await act(async () => save.resolve());
    await continueFromNotificationsToWorkspace();
    // This test renders the confirmation dialog through a pending save.
  }, 2_500);

  test("keeps the no-runtime warning visible after confirmation is cancelled", async () => {
    const runtimes = DEFAULT_AGENT_RUNTIMES;
    const client: Partial<HostClient> = {};
    client.runtimeExecutablesCheck = mock(async () => createCheck(runtimes));

    renderOnboarding({ client, runtimes });
    await enterRuntimeStage();
    fireEvent.click(screen.getByRole<HTMLButtonElement>("button", { name: /Continue/ }));
    await screen.findByRole("dialog", { name: "Continue without a coding agent?" });

    fireEvent.click(await screen.findByRole<HTMLButtonElement>("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Continue without a coding agent?" })).toBeNull();
    expect(
      screen.getByText(
        "Agent sessions will not work until you configure and enable a valid coding agent in Settings.",
      ),
    ).toBeTruthy();
  });
});
