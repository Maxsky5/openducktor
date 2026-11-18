import { describe, expect, test } from "bun:test";
import { IDENTITY_TEXT, TILE_PALETTE } from "./replicas/settings/RepositoryConfiguration";
import { SETTINGS_SECTIONS, SETTINGS_TEXT } from "./replicas/settings/SettingsDialog";
import { WORKSPACE, WORKSPACES } from "./sample/workspace";
import { FIRST_REPOSITORY_SECTION, FIRST_SECTION } from "./scenes/keyboard-shortcuts/sample";
import { importProduct, readProductWords } from "./test-support/product-source";

type Section = { id: string; label: string; icon: { displayName?: string } };

const SETTINGS = "packages/frontend/src/components/features/settings";
const IDENTITY = "packages/frontend/src/components/features/workspace-identity";

// SAFETY: settings-modal-constants.ts exports the sections, and a missing export fails the test.
const constants = await importProduct<{
  SETTINGS_SECTIONS: readonly Section[];
  REPOSITORY_SECTIONS: readonly { id: string; label: string }[];
}>(`${SETTINGS}/settings-modal-constants.ts`);
// SAFETY: settings-modal-open-state.ts exports the first navigation of Settings.
const { INITIAL_NAVIGATION } = await importProduct<{
  INITIAL_NAVIGATION: { section: string; repositorySection: string };
}>(`${SETTINGS}/settings-modal-open-state.ts`);
// SAFETY: workspace-tile-appearance.ts exports these values, and a missing export fails the test.
const tiles = await importProduct<{
  WORKSPACE_TILE_PALETTE: readonly { hex: string }[];
  deriveWorkspaceInitials: (name: string) => string;
}>("packages/frontend-core/src/workspaces/workspace-tile-appearance.ts");
// SAFETY: the contracts export this value, and a missing export fails the test.
const { WORKSPACE_ABBREVIATION_MAX_LENGTH } = await importProduct<{
  WORKSPACE_ABBREVIATION_MAX_LENGTH: number;
}>("packages/contracts/src/index.ts");

describe("the Settings dialog copied from the app", () => {
  test("the menu lists the sections of the app with their icons", () => {
    expect(
      constants.SETTINGS_SECTIONS.map(({ label, icon }) => ({ label, icon: icon.displayName })),
    ).toEqual(SETTINGS_SECTIONS.map(({ label, Icon }) => ({ label, icon: Icon.displayName })));
  });

  test("Settings opens first on the Configuration of Repositories", () => {
    const section = constants.SETTINGS_SECTIONS.find(
      (entry) => entry.id === INITIAL_NAVIGATION.section,
    );
    const repository = constants.REPOSITORY_SECTIONS.find(
      (entry) => entry.id === INITIAL_NAVIGATION.repositorySection,
    );
    expect(section?.label).toBe(FIRST_SECTION);
    expect(repository?.label).toBe(FIRST_REPOSITORY_SECTION);
  });

  test("the header and the footer have the words of the app", async () => {
    const dialog = await readProductWords([
      `${SETTINGS}/settings-modal.tsx`,
      `${SETTINGS}/settings-modal-footer.tsx`,
    ]);
    expect(dialog).toContain(`<DialogTitle>${SETTINGS_TEXT.title}</DialogTitle>`);
    expect(dialog).toContain(`<DialogDescription>${SETTINGS_TEXT.description}</DialogDescription>`);
    expect(dialog).toContain(`"${SETTINGS_TEXT.saving}" : "${SETTINGS_TEXT.save}"`);
    expect(dialog).toContain(`> ${SETTINGS_TEXT.cancel} </Button>`);
  });

  test("the Configuration section shows the words and the swatches of the app", async () => {
    const source = await readProductWords([
      `${SETTINGS}/settings-repository-configuration-section.tsx`,
      `${IDENTITY}/workspace-identity-fields.tsx`,
      `${IDENTITY}/workspace-tile-color-picker.tsx`,
    ]);
    const { abbreviationHint, ...inMarkup } = IDENTITY_TEXT;
    for (const text of Object.values(inMarkup)) expect(source).toContain(text);
    expect(source).toContain("Up to {WORKSPACE_ABBREVIATION_MAX_LENGTH} characters.");
    expect(`Up to ${WORKSPACE_ABBREVIATION_MAX_LENGTH} characters.`).toBe(abbreviationHint);
    expect(tiles.WORKSPACE_TILE_PALETTE.map(({ hex }) => hex)).toEqual([...TILE_PALETTE]);
    expect(tiles.deriveWorkspaceInitials(WORKSPACE)).toBe(WORKSPACES[0].tile);
  });
});
