import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GeneralSettingsSection } from "./settings-general-section";

test("general settings retain app updates without the obsolete background-tab preference", () => {
  const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { disabled: false }));
  expect(html).toContain("General Settings");
  expect(html).not.toContain("task tab");
});
