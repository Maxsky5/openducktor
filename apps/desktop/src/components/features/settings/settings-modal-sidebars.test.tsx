import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSidebar } from "./settings-modal-sidebars";

describe("settings modal sidebars", () => {
  test("renders all settings sections including chat", () => {
    const errorCountById = {
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
      chat: 0,
      kanban: 0,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        section: "general",
        disabled: false,
        errorCountById,
        onChange: () => {},
      }),
    );

    expect(html).toContain("General");
    expect(html).toContain("Git");
    expect(html).toContain("Repositories");
    expect(html).toContain("Prompts");
    expect(html).toContain("Chat");
  });

  test("renders chat section as active when selected", () => {
    const errorCountById = {
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
      chat: 0,
      kanban: 0,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        section: "chat",
        disabled: false,
        errorCountById,
        onChange: () => {},
      }),
    );

    expect(html).toContain("Chat");
  });

  test("disables all buttons when disabled prop is true", () => {
    const errorCountById = {
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
      chat: 0,
      kanban: 0,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        section: "general",
        disabled: true,
        errorCountById,
        onChange: () => {},
      }),
    );

    expect(html).toContain("disabled");
  });

  test("displays error count for chat section when errors exist", () => {
    const errorCountById = {
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
      chat: 2,
      kanban: 0,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        section: "general",
        disabled: false,
        errorCountById,
        onChange: () => {},
      }),
    );

    expect(html).toContain("Chat");
    expect(html).toContain("2");
  });
});
