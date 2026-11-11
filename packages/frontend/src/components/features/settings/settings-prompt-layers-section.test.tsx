import { workflowPromptSettings } from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import {
  builtinCompiledCatalogFixture,
  builtinWorkflowCatalogFixture,
} from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { compileWorkflowCatalog, type PromptSettingsLayers } from "@openducktor/workflows";
import { specPlanBuildPromptKey } from "@openducktor/workflows/test-support";
import { expect, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { WorkflowTestProvider } from "@/test-utils/workflow-provider";
import { PromptLayersSection } from "./settings-prompt-layers-section";
import { PROMPT_HOME_VIEW, type PromptView } from "./settings-prompt-owners";
import { buildPromptLayerValidationErrors } from "./settings-prompt-layers";

const templates = workflowPromptSettings(builtinCompiledCatalogFixture).templates;
const specStartKey = specPlanBuildPromptKey("messages.spec_start");
const specStart = templates.find(({ key }) => key === specStartKey)!;

function GlobalPrompts({ initial }: { initial: PromptSettingsLayers }) {
  const [layers, setLayers] = useState(initial);
  const [view, setView] = useState<PromptView>(PROMPT_HOME_VIEW);
  return (
    <PromptLayersSection
      title="System prompts"
      description="Changes apply in every repository."
      scope={{ kind: "global", edited: layers }}
      validationErrors={buildPromptLayerValidationErrors(layers, templates)}
      view={view}
      disabled={false}
      onViewChange={setView}
      onUpdateLayers={(updater) => setLayers(updater)}
    />
  );
}

const renderPrompts = (initial: PromptSettingsLayers = { overrides: {}, appends: {} }) =>
  render(
    <WorkflowTestProvider>
      <GlobalPrompts initial={initial} />
    </WorkflowTestProvider>,
  );

type View = ReturnType<typeof render>;
/** The row of a prompt or a workflow. Its text also holds its description, roles, and badges. */
const row = (view: View, label: string) => view.getByRole("button", { name: label });
const openWorkflow = (view: View, title = "Spec, Plan, Build") => fireEvent.click(row(view, title));
/** Opens a prompt of the Spec, Plan, Build workflow from its workflow page. */
const open = (view: View, label: string) => {
  openWorkflow(view);
  fireEvent.click(row(view, label));
};
const back = (view: View, title = "Spec, Plan, Build") =>
  fireEvent.click(view.getByRole("button", { name: `Back to ${title}` }));
const header = (view: View, label: string) =>
  view.getByRole("heading", { name: label }).closest("header")!.textContent;
const finalText = (view: View) => view.getByRole("region", { name: "Final text" });
const search = (view: View) => view.getByRole("textbox", { name: "Search all prompts" });
/** The keys of the rows on the screen: a prompt key, or the ID of a workflow. */
const rowKeys = (view: View) =>
  view
    .getAllByRole("button")
    .flatMap((button) => (button.dataset.focusKey ? [button.dataset.focusKey] : []));

test("the first screen lists the role instructions, then each workflow with its state", () => {
  const view = renderPrompts();
  try {
    const roles = within(view.getByRole("region", { name: "Agent roles" }));
    expect(roles.getByRole("button", { name: "Spec" })).toBeDefined();
    const workflows = within(view.getByRole("region", { name: "Workflows" }));
    expect(workflows.getByRole("button", { name: "Spec, Plan, Build" }).textContent).toContain(
      "13 prompts",
    );
    // The first screen does not list the prompts of a workflow.
    expect(view.queryByRole("button", { name: "Spec Kickoff" })).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a workflow page lists the prompts of the workflow by when the agent gets them", () => {
  const view = renderPrompts();
  try {
    openWorkflow(view);
    expect(document.activeElement).toBe(view.getByRole("heading", { name: "Spec, Plan, Build" }));
    expect(view.queryByRole("button", { name: "Spec" })).toBeNull();
    expect(view.getByRole("region", { name: "Rules for every session" })).toBeDefined();
    expect(view.getByRole("region", { name: "Messages to agents" })).toBeDefined();
    expect(view.getByRole("region", { name: "Goal mode" })).toBeDefined();
    expect(view.getByRole("region", { name: "Replies to agents" })).toBeDefined();
    expect(row(view, "Builder Kickoff").textContent).toContain("Builder");
    // An unchanged prompt has no badge, so the changed prompts stand out.
    expect(row(view, "Spec Kickoff").textContent).not.toContain("Default");

    back(view, "System prompts");
    expect(document.activeElement).toBe(row(view, "Spec, Plan, Build"));
  } finally {
    view.unmount();
  }
});

test("each workflow has its own page and its own prompts", () => {
  const [descriptor] = builtinWorkflowCatalogFixture.workflows;
  const catalog = compileWorkflowCatalog({
    ...builtinWorkflowCatalogFixture,
    workflows: [
      descriptor!,
      {
        ...descriptor!,
        definition: { ...descriptor!.definition, id: "bug-triage", label: "Bug Triage" },
      },
    ],
  });
  const view = render(
    <WorkflowTestProvider catalog={catalog}>
      <GlobalPrompts initial={{ overrides: {}, appends: {} }} />
    </WorkflowTestProvider>,
  );
  try {
    openWorkflow(view, "Bug Triage");
    expect(view.getByRole("region", { name: "Prompts of Bug Triage" })).toBeDefined();
    fireEvent.click(row(view, "QA Kickoff"));
    back(view, "Bug Triage");
    expect(document.activeElement).toBe(row(view, "QA Kickoff"));
  } finally {
    view.unmount();
  }
});

test("typing an append turns it on, marks the prompt, and adds it to the final text", () => {
  const view = renderPrompts();
  try {
    open(view, "Spec Kickoff");
    expect(document.activeElement).toBe(view.getByRole("heading", { name: "Spec Kickoff" }));
    expect(header(view, "Spec Kickoff")).toContain("First message to the Spec agent");
    expect(header(view, "Spec Kickoff")).toContain(
      "Your changes apply to every task of Spec, Plan, Build, in every repository.",
    );
    fireEvent.change(view.getByLabelText("Append instructions"), {
      target: { value: "Link the spec to {{task.id}}." },
    });

    expect(
      view.getByRole("switch", { name: "Use append instructions" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(header(view, "Spec Kickoff")).toContain("Appended");
    expect(within(finalText(view)).getByText("Append · all repositories")).toBeDefined();
    expect(finalText(view).textContent).toContain("Link the spec to {{task.id}}.");

    fireEvent.click(view.getByRole("switch", { name: "Use append instructions" }));
    expect(within(finalText(view)).queryByText("Append · all repositories")).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Use append instructions" }));

    back(view);
    expect(row(view, "Spec Kickoff").textContent).toContain("Appended");
    expect(document.activeElement).toBe(row(view, "Spec Kickoff"));
  } finally {
    view.unmount();
  }
});

test("a placeholder button inserts the placeholder at the caret and turns the append on", () => {
  const view = renderPrompts();
  try {
    open(view, "Spec Kickoff");
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Append instructions");
    fireEvent.change(editor, { target: { value: "Link  now." } });
    editor.setSelectionRange(5, 5);
    fireEvent.click(view.getByRole("button", { name: "task.id" }));

    expect(editor.value).toBe("Link {{task.id}} now.");
    expect(editor.selectionStart).toBe("Link {{task.id}}".length);
    expect(
      view.getByRole("switch", { name: "Use append instructions" }).getAttribute("aria-checked"),
    ).toBe("true");
  } finally {
    view.unmount();
  }
});

test("an append placeholder that the prompt cannot fill shows below the editor and in the section", () => {
  const view = renderPrompts();
  try {
    open(view, "Spec Kickoff");
    fireEvent.change(view.getByLabelText("Append instructions"), {
      target: { value: "Rebase {{git.currentBranch}}." },
    });
    expect(view.getByText(/This prompt cannot fill \{\{git.currentBranch\}\}/)).toBeDefined();
    expect(header(view, "Spec Kickoff")).toContain("Error");

    back(view);
    expect(row(view, "Spec Kickoff").textContent).toContain("Error");
    back(view, "System prompts");
    // The first screen shows the error of the workflow.
    expect(row(view, "Spec, Plan, Build").textContent).toContain("1 error");
  } finally {
    view.unmount();
  }
});

test("the override shows only after Replace built-in prompt and starts from the built-in text", () => {
  const view = renderPrompts();
  try {
    open(view, "Spec Kickoff");
    expect(view.queryByLabelText("Replacement prompt")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Replace" }));
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Replacement prompt");
    expect(editor.value).toBe(specStart.template);
    expect(document.activeElement).toBe(editor);
    expect(header(view, "Spec Kickoff")).toContain("Overridden");
    expect(within(finalText(view)).getByText("Override · all repositories")).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Remove override" }));
    expect(view.queryByLabelText("Replacement prompt")).toBeNull();
  } finally {
    view.unmount();
  }
});

test("an outdated override offers the built-in text, keep, and remove", () => {
  const view = renderPrompts({
    overrides: { [specStartKey]: { template: "Old {{task.id}}", baseVersion: 1, enabled: true } },
    appends: {},
  });
  try {
    openWorkflow(view);
    expect(row(view, "Spec Kickoff").textContent).toContain("Outdated");
    fireEvent.click(row(view, "Spec Kickoff"));
    expect(view.getByText("The built-in prompt changed")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "View built-in text" }));
    expect(view.getByLabelText("Built-in text").textContent).toBe(specStart.template);

    fireEvent.click(view.getByRole("button", { name: "Keep my override" }));
    expect(view.queryByText("The built-in prompt changed")).toBeNull();
    expect(header(view, "Spec Kickoff")).not.toContain("Outdated");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Replacement prompt").value).toBe(
      "Old {{task.id}}",
    );
  } finally {
    view.unmount();
  }
});

test("search and Changed only show the prompts of every owner, under the name of the owner", () => {
  const view = renderPrompts({
    overrides: {},
    appends: { [specStartKey]: { text: "Extra.", enabled: true } },
  });
  try {
    fireEvent.change(search(view), { target: { value: "conflict" } });
    expect(
      within(view.getByRole("region", { name: "Spec, Plan, Build" })).getByRole("button", {
        name: "Builder Git Conflict Message",
      }),
    ).toBeDefined();
    expect(view.queryByRole("region", { name: "Workflows" })).toBeNull();
    // The name of a workflow finds the workflow, not every prompt of the workflow.
    fireEvent.change(search(view), { target: { value: "spec, plan, build" } });
    expect(
      within(view.getByRole("region", { name: "Workflows" })).getByRole("button", {
        name: "Spec, Plan, Build",
      }),
    ).toBeDefined();
    expect(rowKeys(view)).toEqual(["openducktor-spec-plan-build"]);
    fireEvent.change(search(view), { target: { value: "nothing here" } });
    expect(view.getByText("No prompt matches your search.")).toBeDefined();
    expect(view.getByText("Clear search", { selector: "button" })).toBeDefined();

    fireEvent.change(search(view), { target: { value: "" } });
    fireEvent.click(view.getByRole("button", { name: "Changed only", pressed: false }));
    // The filter shows how many prompts changed, as the Kanban filters do.
    expect(view.getByRole("button", { name: "Changed only 1", pressed: true })).toBeDefined();
    expect(rowKeys(view)).toEqual([specStartKey]);

    // A prompt opened from the results returns to the results.
    fireEvent.click(row(view, "Spec Kickoff"));
    back(view, "System prompts");
    expect(document.activeElement).toBe(row(view, "Spec Kickoff"));
  } finally {
    view.unmount();
  }
});

test("back from a prompt that the filter now hides focuses the list", () => {
  const view = renderPrompts({
    overrides: {},
    appends: { [specStartKey]: { text: "Extra.", enabled: true } },
  });
  try {
    fireEvent.click(view.getByRole("button", { name: "Changed only", pressed: false }));
    fireEvent.click(row(view, "Spec Kickoff"));
    fireEvent.click(view.getByRole("button", { name: /^Remove append/ }));
    back(view, "System prompts");
    expect(view.getByText("You have not changed any prompt yet.")).toBeDefined();
    expect(
      document.activeElement?.contains(view.getByText("You have not changed any prompt yet.")),
    ).toBe(true);
  } finally {
    view.unmount();
  }
});

test("a click on the collapsed built-in text shows all of it, and Show less folds it again", () => {
  const view = renderPrompts();
  try {
    fireEvent.click(row(view, "Spec"));
    expect(view.getByRole("button", { name: "Back to System prompts" })).toBeDefined();
    const preview = view.getByRole("button", { name: "Show all of the Built-in text" });
    fireEvent.click(preview);
    expect(view.queryByRole("button", { name: "Show all of the Built-in text" })).toBeNull();
    // The full text takes the focus from the preview, which unmounts.
    expect(document.activeElement?.textContent).toContain("Spec");
    fireEvent.click(view.getByRole("button", { name: "Show less" }));
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Show all of the Built-in text" }),
    );
  } finally {
    view.unmount();
  }
});

test("a placeholder insert keeps the scroll of the text", () => {
  const view = renderPrompts();
  const focus = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "focus");
  try {
    open(view, "Spec Kickoff");
    fireEvent.click(view.getByRole("button", { name: "Replace" }));
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Replacement prompt");
    editor.setSelectionRange(20, 20);
    editor.scrollTop = 120;
    // A browser scrolls a textarea to its end when its value changes, and focus can scroll it.
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      value(this: HTMLElement) {
        this.scrollTop = 999;
      },
    });
    const replacement = within(editor.closest("section")!);
    fireEvent.click(replacement.getByRole("button", { name: "task.id" }));
    expect(editor.scrollTop).toBe(120);
    expect(editor.selectionStart).toBe(20 + "{{task.id}}".length);
  } finally {
    if (focus) Object.defineProperty(HTMLElement.prototype, "focus", focus);
    view.unmount();
  }
});

test("with Changed only, a search for a workflow name shows the changed prompts of the workflow", () => {
  const view = renderPrompts({
    overrides: {},
    appends: { [specStartKey]: { text: "Extra.", enabled: true } },
  });
  try {
    fireEvent.click(view.getByRole("button", { name: "Changed only", pressed: false }));
    fireEvent.change(search(view), { target: { value: "plan, build" } });
    expect(rowKeys(view)).toEqual([specStartKey]);
    fireEvent.change(search(view), { target: { value: "nothing here" } });
    expect(view.getByText("No changed prompt matches your search.")).toBeDefined();
  } finally {
    view.unmount();
  }
});
