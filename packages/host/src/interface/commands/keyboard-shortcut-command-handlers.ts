import { shortcutPreferencesSchema } from "@openducktor/contracts";
import type { KeyboardShortcutSettingsService } from "../../application/keyboard-shortcuts/keyboard-shortcut-settings-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { requireNoArgs, requireObjectArgs, requireParsedInput } from "./command-inputs";

export const createKeyboardShortcutCommandHandlers = (
  keyboardShortcuts: Pick<KeyboardShortcutSettingsService, "read" | "save">,
) =>
  ({
    workspace_get_keyboard_shortcuts: (args) => {
      requireNoArgs("workspace_get_keyboard_shortcuts", args);
      return keyboardShortcuts.read();
    },
    workspace_save_keyboard_shortcuts: (args) =>
      keyboardShortcuts.save(
        requireParsedInput(
          shortcutPreferencesSchema,
          requireObjectArgs("workspace_save_keyboard_shortcuts", args, "preferences"),
          "preferences",
        ),
      ),
  }) satisfies HostCommandHandlerDefinitions;
