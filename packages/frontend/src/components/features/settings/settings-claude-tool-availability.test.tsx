import { afterEach, expect, test } from "bun:test";
import {
  claudeRuntimeConfigSchema,
  type ClaudeRuntimeConfig,
  type ClaudeToolCatalog,
} from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ClaudeToolAvailabilityEditor } from "./settings-claude-tool-availability";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});
const catalog: ClaudeToolCatalog = {
  runtimeKind: "claude",
  runtimeId: "r",
  tools: [
    { name: "Read", canDisable: true },
    { name: "EndConversation", canDisable: false, limitation: "Claude reserves this tool." },
  ],
};
const chooseTools = (role: string, option: string) => {
  fireEvent.click(screen.getByRole("button", { name: `${role} tool availability` }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${option}`) }));
};

function renderEditor(
  initial: ClaudeRuntimeConfig,
  read: { catalog: ClaudeToolCatalog | undefined; error: string | null; loading: boolean } = {
    catalog,
    error: null,
    loading: false,
  },
) {
  let current = initial;
  function Form({ error = read.error }: { error?: string | null }) {
    const [config, setConfig] = useState(initial);
    return (
      <ClaudeToolAvailabilityEditor
        config={config}
        disabled={false}
        catalog={error ? undefined : read.catalog}
        error={error}
        loading={read.loading}
        onRetry={() => {}}
        onChange={(next) => {
          current = next;
          setConfig(next);
        }}
      />
    );
  }
  const rendered = render(<Form />);
  return {
    current: () => current,
    failRead: () =>
      rendered.rerender(<Form error="Native metadata missing. Update Claude Code and retry." />),
  };
}

test.each(["light", "dark"])("tool choices and search retain edits in %s theme", (theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const form = renderEditor(claudeRuntimeConfigSchema.parse({ enabled: true, executablePath: "" }));
  expect(
    screen.getByRole("switch", { name: "Default Artifact" }).getAttribute("aria-checked"),
  ).toBe("false");
  expect(screen.getByRole("switch", { name: "Default Read" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(screen.queryByRole("switch", { name: "Default EndConversation" })).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Default Artifact" }));
  fireEvent.click(screen.getByRole("switch", { name: "Default Read" }));
  const edited = structuredClone(form.current());
  fireEvent.change(screen.getByRole("textbox", { name: "Search Claude tools" }), {
    target: { value: "artifactdata" },
  });
  expect(screen.getByRole("switch", { name: "Default ArtifactData" })).toBeDefined();
  expect(screen.queryByRole("switch", { name: "Default Read" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Claude tools" }), {
    target: { value: "no-match" },
  });
  expect(screen.getByText("No tools match the search.")).toBeDefined();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Claude tools" }), {
    target: { value: "" },
  });
  expect(form.current()).toEqual(edited);
  expect(
    screen.getByRole("switch", { name: "Default Artifact" }).getAttribute("aria-checked"),
  ).toBe("true");
});

test("role lists copy defaults, preserve sibling policy, and return to inheritance", () => {
  const form = renderEditor(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { permissions: { ask: ["Read"] } },
      roleOverrides: { qa: { sandbox: { enabled: true } }, build: { toolAvailability: {} } },
    }),
  );
  expect(
    screen
      .getByRole("switch", { name: "Enable Tool availability role overrides" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "QA tool availability" }).textContent).toBe(
    "Inherited",
  );
  expect(screen.queryByRole("switch", { name: "QA Artifact" })).toBeNull();
  chooseTools("QA", "Use this list");
  expect(form.current().roleOverrides.qa?.toolAvailability).toEqual({
    Artifact: false,
    ArtifactComments: false,
    ArtifactData: false,
  });
  fireEvent.click(screen.getByRole("switch", { name: "QA Artifact" }));
  expect(form.current().roleOverrides.qa?.toolAvailability).toEqual({
    Artifact: true,
    ArtifactComments: false,
    ArtifactData: false,
  });
  expect(form.current().defaults.toolAvailability).toBeUndefined();
  expect(form.current().roleOverrides.build?.toolAvailability).toEqual({});
  expect(form.current().roleOverrides.qa?.sandbox?.enabled).toBe(true);
  expect(
    screen.getByRole("switch", { name: "Default Artifact" }).getAttribute("aria-checked"),
  ).toBe("false");
  chooseTools("QA", "Inherited");
  expect(form.current().roleOverrides.qa?.toolAvailability).toBeUndefined();
  expect(form.current().roleOverrides.qa?.sandbox?.enabled).toBe(true);
  expect(screen.queryByRole("switch", { name: "QA Artifact" })).toBeNull();
  expect(screen.getByRole("button", { name: "Builder tool availability" }).textContent).toBe(
    "Use this list",
  );
  expect(
    screen.getByRole("switch", { name: "Builder Artifact" }).getAttribute("aria-checked"),
  ).toBe("true");
});

test("role controls are opt in and turning them off clears only tool overrides", () => {
  const initial = claudeRuntimeConfigSchema.parse({
    enabled: true,
    executablePath: "",
    defaults: { toolAvailability: { Read: false, RetiredTool: true } },
    roleOverrides: {
      qa: { sandbox: { enabled: true } },
      planner: { permissionMode: "acceptEdits" },
    },
  });
  const form = renderEditor(initial);
  expect(screen.queryByRole("button", { name: "QA tool availability" })).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Enable Tool availability role overrides" }));
  expect(form.current()).toEqual(initial);
  chooseTools("QA", "Use this list");
  fireEvent.click(screen.getByRole("switch", { name: "QA Read" }));
  chooseTools("Planner", "Use this list");
  expect(form.current().roleOverrides.qa?.toolAvailability?.Read).toBe(true);
  expect(form.current().roleOverrides.planner?.toolAvailability?.Read).toBe(false);
  fireEvent.click(screen.getByRole("switch", { name: "Enable Tool availability role overrides" }));
  expect(screen.queryByRole("button", { name: "QA tool availability" })).toBeNull();
  expect(form.current()).toEqual(initial);
});

test("edits a saved Task exclusion through the current Agent switch", () => {
  const form = renderEditor(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { toolAvailability: { Task: false, RetiredTool: false } },
    }),
    {
      catalog: { ...catalog, tools: [{ name: "Agent", canDisable: true }] },
      error: null,
      loading: false,
    },
  );
  expect(screen.getByRole("switch", { name: "Default Agent" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(screen.queryByRole("switch", { name: "Default Task" })).toBeNull();
  expect(form.current().defaults.toolAvailability).toEqual({ Task: false, RetiredTool: false });
  fireEvent.click(screen.getByRole("switch", { name: "Default Agent" }));
  expect(form.current().defaults.toolAvailability).toEqual({ Agent: true, RetiredTool: false });
  const saved = claudeRuntimeConfigSchema.parse(form.current());
  cleanup();
  renderEditor(saved, {
    catalog: { ...catalog, tools: [{ name: "Agent", canDisable: true }] },
    error: null,
    loading: false,
  });
  expect(screen.getByRole("switch", { name: "Default Agent" }).getAttribute("aria-checked")).toBe(
    "true",
  );
});

test("clears a reserved-tool exclusion without offering a disable switch", () => {
  const form = renderEditor(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { toolAvailability: { EndConversation: false, Read: false } },
    }),
  );
  expect(screen.queryByRole("switch", { name: "Default EndConversation" })).toBeNull();
  expect(screen.getByText("Claude reserves this tool.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Remove Default EndConversation exclusion" }));
  expect(form.current().defaults.toolAvailability).toEqual({ EndConversation: true, Read: false });
  expect(
    screen.queryByRole("button", { name: "Remove Default EndConversation exclusion" }),
  ).toBeNull();
});

test.each(
  (["omitted", "loading", "failed"] as const).flatMap((state) =>
    [true, false].map((enabled) => [state, enabled] as const),
  ),
)("keeps reserved-tool limits with %s metadata and preference %s", (state, enabled) => {
  const read = {
    catalog:
      state === "omitted" ? { ...catalog, tools: [{ name: "Read", canDisable: true }] } : undefined,
    error: state === "failed" ? "Native metadata missing. Update Claude Code and retry." : null,
    loading: state === "loading",
  };
  const form = renderEditor(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { toolAvailability: { EndConversation: enabled, RetiredTool: false } },
    }),
    read,
  );
  expect(screen.queryByRole("switch", { name: "Default EndConversation" })).toBeNull();
  expect(screen.getByText(/Claude reserves EndConversation/)).toBeDefined();
  expect(screen.getByRole("switch", { name: "Default RetiredTool" })).toBeDefined();
  expect(form.current().defaults.toolAvailability).toEqual({
    EndConversation: enabled,
    RetiredTool: false,
  });
  if (!enabled) {
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Default EndConversation exclusion" }),
    );
    expect(form.current().defaults.toolAvailability).toEqual({
      EndConversation: true,
      RetiredTool: false,
    });
  }
  expect(
    screen.queryByRole("button", { name: "Remove Default EndConversation exclusion" }),
  ).toBeNull();
});

test("catalog failure retains explicit choices and the draft without claiming new unavailability", () => {
  const form = renderEditor(
    claudeRuntimeConfigSchema.parse({
      enabled: true,
      executablePath: "",
      defaults: { toolAvailability: { RetiredTool: true } },
    }),
  );
  expect(screen.getByRole("switch", { name: "Default RetiredTool" })).toBeDefined();
  fireEvent.click(screen.getByRole("switch", { name: "Default Artifact" }));
  const draft = structuredClone(form.current());
  form.failRead();
  expect(screen.getByRole("alert").textContent).toContain("Update Claude Code");
  expect(screen.getByRole("button", { name: "Retry tool catalog" })).toBeDefined();
  expect(screen.queryAllByText("Unavailable in this catalog")).toHaveLength(0);
  expect(form.current()).toEqual(draft);
  expect(
    screen.getByRole("switch", { name: "Default RetiredTool" }).getAttribute("aria-checked"),
  ).toBe("true");
});
