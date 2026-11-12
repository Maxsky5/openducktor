import { describe, expect, test } from "bun:test";
import { LAUNCH_KINDS } from "./replicas/studio/PanelLauncher";
import {
  BLANK_PAGE,
  BROWSER_ADDRESS_PLACEHOLDER,
  DEV_SERVER,
  DEV_SERVER_SHORT,
  NEW_TAB_LABEL,
  PAGE_TITLE,
  SHARED_BADGE,
} from "./sample/browser";
import { importProduct } from "./test-support/product-source";

type TabKindRule = { label: string; description: string };
type BrowserTabData = { tab: { title: string | null; url: string } | null };

const PANELS = "packages/frontend/src/features/session-panels";

// SAFETY: panel-tab-kinds.ts exports these rules, and a missing export fails the test.
const { PANEL_TAB_KIND_RULES } = await importProduct<{
  PANEL_TAB_KIND_RULES: Record<string, TabKindRule>;
}>(`${PANELS}/panel-tab-kinds.ts`);
// SAFETY: session-panel-tab-presentation.ts exports these labels.
const { NEW_TAB_LABEL: APP_NEW_TAB, PANEL_TAB_BADGE_LABELS } = await importProduct<{
  NEW_TAB_LABEL: string;
  PANEL_TAB_BADGE_LABELS: Record<string, string>;
}>(`${PANELS}/session-panel-tab-presentation.ts`);
// SAFETY: session-panel-browser-tab-presentation.ts exports this function. It reads only the tab.
const { browserPageLabel } = await importProduct<{
  browserPageLabel: (browserTab: BrowserTabData) => string;
}>(`${PANELS}/session-panel-browser-tab-presentation.ts`);
// SAFETY: browser-address-bar.tsx exports this placeholder.
const { BROWSER_ADDRESS_PLACEHOLDER: APP_ADDRESS_PLACEHOLDER } = await importProduct<{
  BROWSER_ADDRESS_PLACEHOLDER: string;
}>("packages/frontend/src/features/browser/components/browser-address-bar.tsx");

describe("the panels and the browser copied from the app", () => {
  test("the launcher shows the label and the description of each host tab kind", () => {
    for (const kind of LAUNCH_KINDS) {
      const rule: TabKindRule | undefined = PANEL_TAB_KIND_RULES[kind.id];
      const copied: TabKindRule = { label: kind.label, description: kind.description };
      expect(copied).toEqual({ label: rule?.label ?? "", description: rule?.description ?? "" });
    }
  });

  test("a browser tab shows Blank page, then the host, then the page title", () => {
    expect(browserPageLabel({ tab: null })).toBe(BLANK_PAGE);
    expect(browserPageLabel({ tab: { title: null, url: DEV_SERVER } })).toBe(DEV_SERVER_SHORT);
    expect(browserPageLabel({ tab: { title: PAGE_TITLE, url: DEV_SERVER } })).toBe(PAGE_TITLE);
  });

  test("the tab labels and the badge are the labels of the app", () => {
    expect(NEW_TAB_LABEL).toBe(APP_NEW_TAB);
    expect(SHARED_BADGE).toBe(PANEL_TAB_BADGE_LABELS.shared ?? "");
  });

  test("the address bar shows the placeholder of the app", () => {
    expect(BROWSER_ADDRESS_PLACEHOLDER).toBe(APP_ADDRESS_PLACEHOLDER);
  });
});
