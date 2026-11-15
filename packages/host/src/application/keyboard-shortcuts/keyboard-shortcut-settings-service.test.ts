import { describe, expect, test } from "bun:test";
import type { ShortcutPreferences } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { createDefaultGlobalConfig, toHostPreferences } from "../../config/global-config";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import {
  createKeyboardShortcutSettingsService,
  type KeyboardShortcutsSavedEvent,
} from "./keyboard-shortcut-settings-service";

const createHarness = (stored: JSONType | undefined) => {
  const global = { ...createDefaultGlobalConfig(), keyboardShortcuts: stored };
  let preferences = toHostPreferences(global);
  let writeFailure: HostOperationError | null = null;
  const events: KeyboardShortcutsSavedEvent[] = [];
  const settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig" | "updatePreferences"> = {
    readGlobalConfig: () =>
      Effect.succeed({ ...global, keyboardShortcuts: preferences.keyboardShortcuts }),
    updatePreferences: (change) =>
      Effect.suspend(() => {
        if (writeFailure) return Effect.fail(writeFailure);
        preferences = change(preferences);
        return Effect.succeed(preferences);
      }),
  };
  const service = createKeyboardShortcutSettingsService({
    settingsConfig,
    publish: (event) => events.push(event),
  });
  return {
    service,
    events,
    stored: () => preferences.keyboardShortcuts,
    failWrites: (failure: HostOperationError) => {
      writeFailure = failure;
    },
  };
};

const palette: ShortcutPreferences = {
  version: 1,
  overrides: {
    palette: {
      key: { kind: "logical", key: "p" },
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
    },
  },
};

describe("createKeyboardShortcutSettingsService", () => {
  test("reads empty preferences when none are saved", async () => {
    const { service } = createHarness(undefined);
    expect(await Effect.runPromise(service.read())).toEqual({ version: 1, overrides: {} });
  });

  test("fails with a validation error when the saved preferences are invalid", async () => {
    const { service } = createHarness({ version: 99, overrides: {} });
    const result = await Effect.runPromise(Effect.result(service.read()));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(HostValidationError);
  });

  test("saves parsed preferences and publishes one event after the write", async () => {
    const harness = createHarness(undefined);
    expect(await Effect.runPromise(harness.service.save(palette))).toEqual(palette);
    expect(harness.events).toEqual([{ type: "keyboard_shortcuts_saved" }]);
    expect(await Effect.runPromise(harness.service.read())).toEqual(palette);
  });

  test("does not write or publish preferences that fail validation", async () => {
    const harness = createHarness(undefined);
    const invalid: ShortcutPreferences = {
      version: 1,
      overrides: {
        palette: {
          key: { kind: "logical", key: "p" },
          mod: false,
          ctrl: false,
          alt: false,
          shift: true,
        },
      },
    };
    const result = await Effect.runPromise(Effect.result(harness.service.save(invalid)));
    expect(result._tag).toBe("Failure");
    expect(harness.stored()).toBeUndefined();
    expect(harness.events).toEqual([]);
  });

  test("does not publish when the write fails", async () => {
    const harness = createHarness(undefined);
    harness.failWrites(new HostOperationError({ operation: "save", message: "Disk is full." }));
    const result = await Effect.runPromise(Effect.result(harness.service.save(palette)));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message).toBe("Disk is full.");
    expect(harness.events).toEqual([]);
  });
});
