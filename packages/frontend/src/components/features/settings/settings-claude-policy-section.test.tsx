import { afterEach, expect, spyOn, test } from "bun:test";
import { claudeRuntimeConfigSchema, type ClaudeRuntimeConfig } from "@openducktor/contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { ClaudePolicySection } from "./settings-claude-policy-section";
import { useSettingsModalClaudePolicy } from "./use-settings-modal-claude-policy";

afterEach(cleanup);
const choose = (name: string, option: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${option}`) }));
};

function renderPolicy(initial: ClaudeRuntimeConfig) {
  let current = initial;
  function Form() {
    const [config, setConfig] = useState(current);
    return (
      <ClaudePolicySection
        config={config}
        disabled={false}
        onChange={(next) => {
          current = next;
          setConfig(next);
        }}
        requiresAcknowledgement={false}
        acknowledged={false}
        onAcknowledgedChange={() => {}}
      />
    );
  }
  render(<Form />);
  return () => current;
}

test("excluded command validation clears after editing without duplicate error keys", () => {
  renderPolicy(claudeRuntimeConfigSchema.parse({ enabled: true, executablePath: "" }));
  fireEvent.click(screen.getByRole("button", { name: "Command options" }));
  const excludedCommands = screen.getByRole("region", { name: "Excluded commands" });
  const consoleError = spyOn(console, "error");
  try {
    choose("Default excluded commands", "Use this list");
    fireEvent.click(within(excludedCommands).getByRole("button", { name: "Add entry" }));
    expect(within(excludedCommands).getAllByRole("alert")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Default excluded commands entry 1" }), {
      target: { value: "git status" },
    });
    expect(within(excludedCommands).queryAllByRole("alert")).toHaveLength(0);
    expect(
      consoleError.mock.calls.filter(([message]) => String(message).includes("same key")),
    ).toHaveLength(0);
  } finally {
    consoleError.mockRestore();
  }
});

test("edits grouped native rules, retains invalid text, and restores default list inheritance", () => {
  const current = renderPolicy(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: {
        permissions: { ask: ["Bash(git status)", "Read(./src/**)"] },
        sandbox: { network: { strictAllowlist: true } },
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Permission rules" }));
  expect(screen.getByRole("heading", { name: "Commands" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "File paths" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Default approval mode" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Default bash sandbox" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Approval mode" }));
  choose("Default approval mode", "Automatic approvals");
  expect(current().defaults.permissionMode).toBe("auto");
  fireEvent.click(screen.getByRole("button", { name: "Default approval mode" }));
  expect(screen.queryByRole("option", { name: /plan/i })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /^Automatic approvals/ }));
  const rules = screen.getByRole("region", { name: "Ask rules" });
  fireEvent.click(within(rules).getByRole("switch", { name: "Enable Ask rules role overrides" }));
  choose("QA ask rules", "Use this list");
  expect(current().roleOverrides.qa?.permissions?.ask).toEqual([]);
  fireEvent.click(within(rules).getAllByRole("button", { name: "Add entry" }).at(-1)!);
  fireEvent.change(screen.getByRole("textbox", { name: "QA ask rules entry 1" }), {
    target: { value: "Read(" },
  });
  expect(current().roleOverrides.qa?.permissions?.ask).toEqual(["Read("]);
  expect(within(rules).getByRole("alert").textContent).toContain(
    "roleOverrides.qa.permissions.ask.0",
  );
  choose("QA ask rules", "Inherited");
  expect(current().roleOverrides.qa?.permissions?.ask).toBeUndefined();
  expect(within(rules).getAllByText("Default: 2 entries")[0]).toBeDefined();
  expect(current().defaults.sandbox?.network?.strictAllowlist).toBe(true);
});

test("role controls inherit defaults and disabling overrides clears only that setting", () => {
  const current = renderPolicy(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { permissionMode: "acceptEdits" },
      roleOverrides: {
        qa: { permissionMode: "dontAsk", sandbox: { enabled: true } },
        build: { permissionMode: "auto" },
      },
    }),
  );
  expect(screen.queryByRole("button", { name: "QA approval mode" })).toBeNull();
  expect(screen.getByRole("button", { name: "Approval mode" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Approval mode" }));
  const approval = screen.getByRole("region", { name: "Approval mode" });
  expect(within(approval).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  choose("QA approval mode", "Inherited");
  expect(current().roleOverrides.qa?.permissionMode).toBeUndefined();
  expect(current().defaults.permissionMode).toBe("acceptEdits");
  expect(within(approval).getAllByText("Default: Accept edits")).toHaveLength(3);
  fireEvent.click(within(approval).getByRole("switch"));
  expect(current().roleOverrides.build?.permissionMode).toBeUndefined();
  expect(current().roleOverrides.qa?.sandbox?.enabled).toBe(true);
  expect(screen.queryByRole("button", { name: "QA approval mode" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Approval mode" }));
  expect(screen.queryByRole("button", { name: "Default approval mode" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Approval mode" }));
  expect(screen.getByRole("button", { name: "Default approval mode" }).textContent).toBe(
    "Accept edits",
  );
});

test("advanced validation reveals the group and role with invalid entries", () => {
  const config = claudeRuntimeConfigSchema.parse({ enabled: true, executablePath: "" });
  config.roleOverrides.qa = { sandbox: { network: { allowedDomains: [""] } } };
  render(
    <ClaudePolicySection
      config={config}
      disabled={false}
      requiresAcknowledgement={false}
      acknowledged={false}
      onAcknowledgedChange={() => {}}
      onChange={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Sandbox network access" }).getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    screen
      .getByRole("textbox", { name: "QA allowed domains entry 1" })
      .getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    screen
      .getAllByRole("alert")
      .some((alert) =>
        alert.textContent?.includes("roleOverrides.qa.sandbox.network.allowedDomains.0"),
      ),
  ).toBe(true);
});

test("acknowledgement resets when the scope changes and on cancel, and identifies invalid entries", () => {
  const baseline = claudeRuntimeConfigSchema.parse({
    enabled: true,
    executablePath: "",
    defaults: { permissionMode: "bypassPermissions" },
  });
  let draft: ClaudeRuntimeConfig = {
    ...baseline,
    roleOverrides: { qa: { sandbox: { enabled: false } } },
  };
  const h = renderHook(
    ({ open, draft }) => useSettingsModalClaudePolicy({ open, baseline, draft }),
    { initialProps: { open: true, draft } },
  );
  expect(h.result.current.claudeSettingsSaveError).toContain("acknowledgement");
  act(() => h.result.current.setClaudeDangerAcknowledged(true));
  expect(h.result.current.claudeSettingsSaveError).toBeNull();
  draft = { ...draft, roleOverrides: { build: { sandbox: { enabled: false } } } };
  h.rerender({ open: true, draft });
  expect(h.result.current.isClaudeDangerAcknowledged).toBe(false);
  act(() => h.result.current.setClaudeDangerAcknowledged(true));
  h.rerender({ open: false, draft });
  h.rerender({ open: true, draft });
  expect(h.result.current.isClaudeDangerAcknowledged).toBe(false);
  draft = {
    ...baseline,
    defaults: { permissions: { deny: ["mcp__future__tool(x)"] } },
    roleOverrides: {},
  };
  h.rerender({ open: true, draft });
  expect(h.result.current.claudeSettingsSaveError).toContain("defaults.permissions.deny.0");
  expect(draft.defaults.permissions?.deny).toEqual(["mcp__future__tool(x)"]);
});
