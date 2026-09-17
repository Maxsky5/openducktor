import electron from "electron";
import { createApplicationMenuTemplate, type MainMenuInput } from "./main-menu-template";

const { Menu } = electron;

export const installApplicationMenu = (input: MainMenuInput): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(input)));
};
