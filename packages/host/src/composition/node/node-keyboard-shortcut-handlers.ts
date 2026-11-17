import {
  createKeyboardShortcutSettingsService,
  type KeyboardShortcutSettingsDependencies,
} from "../../application/keyboard-shortcuts/keyboard-shortcut-settings-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { createKeyboardShortcutCommandHandlers } from "../../interface/commands/keyboard-shortcut-command-handlers";

/** The keyboard shortcut commands. A save tells every client through a run event. */
export const createNodeKeyboardShortcutHandlers = (
  settingsConfig: KeyboardShortcutSettingsDependencies["settingsConfig"],
  eventBus: HostEventBusPort | undefined,
) =>
  createKeyboardShortcutCommandHandlers(
    createKeyboardShortcutSettingsService({
      settingsConfig,
      publish: (payload) => eventBus?.publish({ channel: "openducktor://run-event", payload }),
    }),
  );
