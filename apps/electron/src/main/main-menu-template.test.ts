import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  createViewMenu,
} from "./main-menu-template";

const rolesFromSubmenu = (submenu: unknown): string[] => {
  if (!Array.isArray(submenu)) {
    throw new Error("submenu must be an array");
  }
  return submenu
    .map((item) => (item && typeof item === "object" && "role" in item ? String(item.role) : null))
    .filter((role): role is string => role !== null);
};

describe("main menu template", () => {
  test("adds devtools but not reload roles to the dev View menu", () => {
    const viewMenu = createViewMenu(true);
    const roles = rolesFromSubmenu(viewMenu.submenu);

    expect(roles).toContain("toggleDevTools");
    expect(roles).not.toContain("reload");
    expect(roles).not.toContain("forceReload");
  });

  test("hides devtools outside dev mode", () => {
    const viewMenu = createViewMenu(false);
    const roles = rolesFromSubmenu(viewMenu.submenu);

    expect(roles).not.toContain("toggleDevTools");
  });

  test("adds reload and devtools roles to the dev context menu", () => {
    const roles = createContextMenuTemplate(true).map((item) =>
      "role" in item ? item.role : null,
    );

    expect(roles).toEqual(expect.arrayContaining(["reload", "forceReload", "toggleDevTools"]));
  });

  test("puts reload roles in the main application menu", () => {
    const template = createApplicationMenuTemplate({
      isDevelopment: true,
      appName: "OpenDucktor",
    });
    const mainMenu = template.find((item) => item.label === "OpenDucktor");
    const roles = rolesFromSubmenu(mainMenu?.submenu);

    expect(roles).toEqual(expect.arrayContaining(["reload", "forceReload"]));
    expect(template.some((item) => item.label === "View")).toBe(true);
  });
});
