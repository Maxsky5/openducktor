import { expect, test } from "bun:test";
import { claudeRuntimeConfigSchema } from "@openducktor/contracts";
import {
  buildNewClaudeDangerousSelectionKey,
  readClaudePolicyField,
  updateClaudePolicyField,
} from "./settings-claude-policy";

test("Claude acknowledgement compares explicit choices with the saved scope and field", () => {
  const baseline = claudeRuntimeConfigSchema.parse({
    enabled: true,
    executablePath: "",
    defaults: { permissionMode: "bypassPermissions" },
  });
  expect(buildNewClaudeDangerousSelectionKey({ baseline, draft: baseline })).toBe("");
  const draft = { ...baseline, roleOverrides: { qa: { sandbox: { enabled: false } } } };
  expect(buildNewClaudeDangerousSelectionKey({ baseline, draft })).toBe("qa.sandbox.enabled");
  expect(buildNewClaudeDangerousSelectionKey({ baseline: null, draft })).toBe(
    "defaults.permissionMode|qa.sandbox.enabled",
  );
  expect(
    buildNewClaudeDangerousSelectionKey({
      baseline,
      draft: { ...baseline, defaults: {}, roleOverrides: {} },
    }),
  ).toBe("");
});

test("editing and clearing a Claude leaf retains sibling fields and invalid draft text", () => {
  const original = {
    sandbox: { enabled: true, network: { strictAllowlist: true } },
    permissions: { ask: ["Read"] },
  };
  const explicitEmpty = updateClaudePolicyField(original, "permissions.ask", []);
  expect(readClaudePolicyField(explicitEmpty, "permissions.ask")).toEqual([]);
  const cleared = updateClaudePolicyField(explicitEmpty, "permissions.ask", undefined);
  expect(readClaudePolicyField(cleared, "permissions.ask")).toBeUndefined();
  const invalid = updateClaudePolicyField(cleared, "permissions.ask", ["Read("]);
  expect(invalid.sandbox).toEqual(original.sandbox);
  expect(invalid.permissions?.ask).toEqual(["Read("]);
  expect(original.permissions.ask).toEqual(["Read"]);
});
