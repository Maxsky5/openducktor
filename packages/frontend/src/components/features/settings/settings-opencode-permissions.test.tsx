import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { useState } from "react";
import { openCodeRuntimeConfigSchema, type OpenCodeRuntimeConfig } from "@openducktor/contracts";
import { OpenCodePermissionsSettings } from "./settings-opencode-permissions";

afterEach(cleanup);

function Editor({
  initial,
  disabled = false,
}: {
  initial: OpenCodeRuntimeConfig;
  disabled?: boolean;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <>
      <OpenCodePermissionsSettings config={config} disabled={disabled} onUpdate={setConfig} />
      <output data-testid="rules">{JSON.stringify(config)}</output>
    </>
  );
}
const readConfig = (): OpenCodeRuntimeConfig =>
  openCodeRuntimeConfigSchema.parse(JSON.parse(screen.getByTestId("rules").textContent ?? ""));
const initialConfig = () =>
  openCodeRuntimeConfigSchema.parse({
    enabled: true,
    executablePath: "",
    defaults: {
      rules: [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "bash", pattern: "git *", action: "allow" },
      ],
    },
  });

test("edits and moves overlapping rules without losing the row or its input focus", async () => {
  await withAnimationFrameTestDriver(async (driver) => {
    render(<Editor initial={initialConfig()} />);
    const inputs = screen.getAllByRole<HTMLInputElement>("textbox", { name: "Command pattern" });
    const exception = inputs[1]!;
    fireEvent.change(exception, { target: { value: "git status*" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Defaults rule 2 earlier" }));
    expect(readConfig().defaults.rules.map((rule) => rule.pattern)).toEqual(["git status*", "*"]);
    expect(screen.getAllByRole("textbox", { name: "Command pattern" })[0]).toBe(exception);
    await driver.flushFrames();
    expect(document.activeElement?.getAttribute("aria-labelledby")).toContain("target-label");
    fireEvent.click(screen.getByRole("button", { name: "Remove Defaults rule 1" }));
    expect(readConfig().defaults.rules.map((rule) => rule.pattern)).toEqual(["*"]);
    await driver.flushFrames();
    expect(document.activeElement?.getAttribute("aria-labelledby")).toContain("target-label");
    fireEvent.click(screen.getByRole("button", { name: "Remove Defaults rule 1" }));
    await driver.flushFrames();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add defaults rule" }));
    expect(
      screen.getByText("Inherits native OpenCode behavior, subject to workflow policy."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add defaults rule" }));
    await driver.flushFrames();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Target" }));
    expect(readConfig().defaults.rules).toEqual([
      { permission: "bash", pattern: "*", action: "ask" },
    ]);
  });
});

test("role overrides extend defaults and return to inheritance when removed or disabled", async () => {
  await withAnimationFrameTestDriver(async (driver) => {
    render(<Editor initial={initialConfig()} />);
    const toggle = screen.getByRole("switch", {
      name: "Enable OpenCode permissions role overrides",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    for (const role of ["Spec", "Planner", "Builder", "QA"])
      expect(
        screen.getByRole("button", { name: `${role} permission rules` }).textContent,
      ).toContain("Inherited");
    fireEvent.click(screen.getByRole("button", { name: "QA permission rules" }));
    fireEvent.click(screen.getByRole("option", { name: /Use role rules/ }));
    expect(readConfig().roleOverrides.qa?.rules).toEqual([
      { permission: "bash", pattern: "*", action: "ask" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Add qa rule" }));
    fireEvent.click(screen.getByRole("button", { name: "QA permission rules" }));
    fireEvent.click(screen.getByRole("option", { name: /Use role rules/ }));
    expect(readConfig().roleOverrides.qa?.rules).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove QA rule 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove QA rule 1" }));
    await driver.flushFrames();
    expect(readConfig().roleOverrides.qa).toBeUndefined();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "QA permission rules" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Builder permission rules" }));
    fireEvent.click(screen.getByRole("option", { name: /Use role rules/ }));
    fireEvent.click(screen.getByRole("button", { name: "QA permission rules" }));
    fireEvent.click(screen.getByRole("option", { name: /Use role rules/ }));
    fireEvent.click(screen.getByRole("button", { name: "Builder permission rules" }));
    fireEvent.click(screen.getByRole("option", { name: /^Inherited/ }));
    expect(readConfig().roleOverrides.build).toBeUndefined();
    expect(readConfig().roleOverrides.qa?.rules).toHaveLength(1);
    fireEvent.click(toggle);
    expect(readConfig().roleOverrides).toEqual({});
    expect(readConfig().defaults.rules).toEqual(initialConfig().defaults.rules);
    expect(screen.queryByRole("button", { name: "QA permission rules" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "QA permission rules" }).textContent).toContain(
      "Inherited",
    );
  });
});

test("offers whole web actions and free native MCP selectors with field validation", async () => {
  render(
    <Editor
      initial={openCodeRuntimeConfigSchema.parse({
        enabled: true,
        executablePath: "",
        defaults: { rules: [{ permission: "webfetch", pattern: "*", action: "deny" }] },
      })}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Target" }));
  fireEvent.click(screen.getByRole("option", { name: /Tools and MCP tools/ }));
  const selector = screen.getByRole("textbox", { name: "Tool or MCP selector" });
  fireEvent.change(selector, { target: { value: "myserver_*" } });
  expect(readConfig().defaults.rules[0]?.permission).toBe("myserver_*");
  fireEvent.change(selector, { target: { value: " " } });
  expect(selector.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(selector.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Enter a permission or tool selector.",
  );
  expect(selector).toHaveProperty("value", " ");
});

test.each(["read_*", "bash_custom", "task_server_tool"])(
  "keeps custom selector mode and focus while typing %s character by character",
  (value) => {
    render(<Editor initial={initialConfig()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Target" })[0]!);
    fireEvent.click(screen.getByRole("option", { name: /Tools and MCP tools/ }));
    const selector = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Tool or MCP selector",
    });
    selector.focus();
    for (let length = 1; length <= value.length; length++) {
      fireEvent.change(selector, { target: { value: value.slice(0, length) } });
      expect(screen.getByRole("textbox", { name: "Tool or MCP selector" })).toBe(selector);
      expect(document.activeElement).toBe(selector);
    }
    expect(readConfig().defaults.rules[0]?.permission).toBe(value);
    fireEvent.click(screen.getAllByRole("button", { name: "Target" })[0]!);
    fireEvent.click(screen.getByRole("option", { name: "Read files" }));
    expect(screen.queryByRole("textbox", { name: "Tool or MCP selector" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "File path pattern" })).toBeTruthy();
  },
);

test("replacing a discarded draft resets custom mode to the saved target", () => {
  let draft = initialConfig();
  const onUpdate = (updater: (current: OpenCodeRuntimeConfig) => OpenCodeRuntimeConfig) => {
    draft = updater(draft);
    view.rerender(
      <OpenCodePermissionsSettings config={draft} disabled={false} onUpdate={onUpdate} />,
    );
  };
  const view = render(
    <OpenCodePermissionsSettings config={draft} disabled={false} onUpdate={onUpdate} />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Target" })[0]!);
  fireEvent.click(screen.getByRole("option", { name: /Tools and MCP tools/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Tool or MCP selector" }), {
    target: { value: "read_*" },
  });
  view.rerender(
    <OpenCodePermissionsSettings config={initialConfig()} disabled={false} onUpdate={onUpdate} />,
  );
  expect(screen.queryByRole("textbox", { name: "Tool or MCP selector" })).toBeNull();
  expect(screen.getAllByRole("textbox", { name: "Command pattern" })).toHaveLength(2);
});

test("disables every permission control during saving in both themes", () => {
  for (const theme of ["light", "dark"]) {
    document.documentElement.className = theme;
    const config = initialConfig();
    config.roleOverrides.qa = { rules: [{ permission: "webfetch", pattern: "*", action: "deny" }] };
    const view = render(<Editor initial={config} disabled />);
    expect(
      screen
        .getByRole("switch", { name: "Enable OpenCode permissions role overrides" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "QA permission rules" }).textContent).toContain(
      "Use role rules",
    );
    for (const control of view.container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input, button",
    ))
      expect(control.disabled).toBe(true);
    view.unmount();
  }
});
