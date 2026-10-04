import { expect, test } from "bun:test";
import { openCodeRuntimeConfigSchema } from "./config-schemas";

test("keeps ordered OpenCode exceptions, repeated selectors, and raw patterns", () => {
  const rules = [
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "git ?  *", action: "allow" },
    { permission: "read", pattern: "~/project/*", action: "ask" },
    { permission: "myserver_*", pattern: "*", action: "allow" },
  ];
  const parsed = openCodeRuntimeConfigSchema.parse({
    enabled: true,
    executablePath: "/bin/opencode",
    defaults: { rules },
    roleOverrides: { build: { rules: [rules[1]] } },
  });
  expect(parsed.defaults.rules).toEqual(rules);
  expect(parsed.roleOverrides.build?.rules).toEqual([rules[1]]);
  expect(openCodeRuntimeConfigSchema.parse({ enabled: true, executablePath: "" })).toMatchObject({
    defaults: { rules: [] },
    roleOverrides: {},
  });
});

test.each([
  { permission: " ", pattern: "*", action: "ask", field: "permission" },
  { permission: "bash", pattern: " ", action: "ask", field: "pattern" },
  { permission: "webfetch", pattern: "https://example.com/*", action: "ask", field: "pattern" },
  { permission: "websearch", pattern: "query", action: "ask", field: "pattern" },
  { permission: "doom_loop", pattern: "3", action: "ask", field: "pattern" },
  { permission: "myserver_*", pattern: "argument", action: "ask", field: "pattern" },
  { permission: "bash", pattern: "*", action: "invalid", field: "action" },
])("reports the scope, rule index, and invalid field: %j", ({ field, ...rule }) => {
  const parsed = openCodeRuntimeConfigSchema.safeParse({
    enabled: true,
    executablePath: "",
    roleOverrides: { qa: { rules: [rule] } },
  });
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("Expected invalid rules to fail");
  expect(
    parsed.error.issues.some(
      (issue) => issue.path.join(".") === `roleOverrides.qa.rules.0.${field}`,
    ),
  ).toBe(true);
});
