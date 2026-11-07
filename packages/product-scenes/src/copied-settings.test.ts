import { describe, expect, test } from "bun:test";
import {
  PROMPT_TABS,
  QA_BASE_CARD,
  QA_KICKOFF_CARD,
  SECTION_LABELS,
} from "./scenes/prompts/sample";

type PromptTemplate = { label: string; owner: string; description: string };
/** The compiled workflow catalog of the app. The test passes it on as it is. */
type CompiledCatalog = { roles: readonly { id: string; label: string }[] };
type SettingsData = {
  templates: PromptTemplate[];
  promptTabs: { label: string }[];
};

// The imports are dynamic, so the type check of this package does not check the product source.
const source = (path: string): string => new URL(`../../${path}`, import.meta.url).href;
// SAFETY: settings-modal-constants.ts exports this list, and a missing export fails the test.
const { SETTINGS_SECTIONS } = (await import(
  source("frontend/src/components/features/settings/settings-modal-constants.ts")
)) as { SETTINGS_SECTIONS: readonly { label: string }[] };
// SAFETY: workflow-settings.ts exports this function, and a missing export fails the test.
const { workflowSettingsData } = (await import(
  source("frontend-core/src/queries/workflow-settings.ts")
)) as { workflowSettingsData: (catalog: CompiledCatalog) => SettingsData };
// SAFETY: workflow-fixtures.ts exports the compiled built-in catalog.
const { builtinCompiledCatalogFixture } = (await import(
  source("frontend-core/src/test-support/workflow-fixtures.ts")
)) as { builtinCompiledCatalogFixture: CompiledCatalog };

const settings = workflowSettingsData(builtinCompiledCatalogFixture);

/** The prompt card of the app with this label. */
function card(label: string): PromptTemplate {
  const template = settings.templates.find((entry) => entry.label === label);
  if (template === undefined) throw new Error(`The app has no prompt ${label}.`);
  return { label: template.label, owner: template.owner, description: template.description };
}

describe("settings copied from the app", () => {
  test("the section list is the list of the Settings dialog", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([...SECTION_LABELS]);
  });

  test("the prompt tabs are the tabs of the built-in roles", () => {
    expect(settings.promptTabs.map((tab) => tab.label)).toEqual([...PROMPT_TABS]);
  });

  test("the prompt cards show the title, the owner, and the description of the app", () => {
    expect(QA_BASE_CARD).toEqual(card(QA_BASE_CARD.label));
    expect(QA_KICKOFF_CARD).toEqual(card(QA_KICKOFF_CARD.label));
  });
});
