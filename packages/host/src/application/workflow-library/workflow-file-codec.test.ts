import { describe, expect, test } from "bun:test";
import type { AgentRoleDefinition, WorkflowVersionDocument } from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  builtinWorkflowDocument,
  definitionOfDocument,
  nextVersionPrompts,
  roleFromInput,
  versionToDocument,
} from "@openducktor/workflows";
import { exportWorkflowFile, parseWorkflowFile } from "./workflow-file-codec";

const customRole = (): AgentRoleDefinition =>
  roleFromInput({
    id: "designer",
    label: "Designer",
    tools: [],
    workspaceAccess: "read",
    runtimeScopes: ["workspace"],
    instructions: "Design the screens.\nKeep the design system.",
  });

const versionFixture = (): WorkflowVersionDocument => {
  const document = builtinWorkflowDocument();
  document.definition.id = "design-flow";
  document.definition.label = "Design flow";
  document.definition.roles.push({ id: "designer", writes: [] });
  return {
    definition: definitionOfDocument(document, 1),
    prompts: nextVersionPrompts(document.prompts, []),
    layout: { states: { open: { x: 0, y: 0 }, closed: { x: 400, y: 0 } } },
  };
};

/** The same JSON value with the keys of each object in reverse order. */
const reorderKeys = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value), (_key, entry) =>
    entry !== null && !Array.isArray(entry) && Object(entry) === entry
      ? Object.fromEntries(Object.entries(entry).reverse())
      : entry,
  );

const validText = () => exportWorkflowFile(versionFixture(), [customRole()]).text;

describe("exportWorkflowFile", () => {
  test("names the file after the workflow ID", () => {
    expect(exportWorkflowFile(versionFixture(), []).fileName).toBe("design-flow.workflow.yaml");
  });

  test("gives the same bytes for the same content in any key order", () => {
    const first = exportWorkflowFile(versionFixture(), [customRole()]).text;
    const second = exportWorkflowFile(reorderKeys(versionFixture()), [reorderKeys(customRole())]);
    expect(second.text).toBe(first);
    expect(first).not.toContain("builtinVersion");
    expect(first.startsWith("formatVersion: 1\nworkflow:\n  id: design-flow\n")).toBe(true);
  });

  test("writes multi-line prompts as literal blocks", () => {
    const text = validText();
    expect(text).toContain(
      "    instructions: |-\n      Design the screens.\n      Keep the design system.\n",
    );
    expect(text).toMatch(/\n {4}template: \|[-+]?\n/);
  });

  test("holds the bound custom roles with instructions and no built-in role", () => {
    const parsed = parseWorkflowFile(validText());
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.file.roles.map(({ id }) => id)).toEqual(["designer"]);
    expect(parsed.file.roles[0]?.instructions).toBe("Design the screens.\nKeep the design system.");
    const builtinRoleIds = new Set<string>(BUILTIN_ROLES.map(({ id }) => id));
    expect(parsed.file.workflow.roles.some(({ id }) => builtinRoleIds.has(id))).toBe(true);
  });

  test("round-trips the version content", () => {
    const version = versionFixture();
    const parsed = parseWorkflowFile(exportWorkflowFile(version, [customRole()]).text);
    if (!parsed.ok) throw new Error(parsed.message);
    const document = versionToDocument(version);
    expect(parsed.file.workflow).toEqual(document.definition);
    expect(parsed.file.prompts).toEqual(document.prompts);
    expect(parsed.file.layout).toEqual(document.layout);
  });
});

describe("parseWorkflowFile", () => {
  const failureOf = (text: string) => {
    const result = parseWorkflowFile(text);
    if (result.ok) throw new Error("The text parsed.");
    return result;
  };

  test("stops text that is not YAML at its location", () => {
    const failure = failureOf("formatVersion: 1\nworkflow: [a, b\n");
    expect(failure.message).toStartWith("The text is not readable YAML.");
    expect(failure.line).toBe(3);
  });

  test("stops an unresolved alias at its location", () => {
    const failure = failureOf("formatVersion: 1\nworkflow: *missing\n");
    expect(failure.message).toStartWith("The text is not readable YAML.");
    expect(failure.message).toContain("missing");
    expect([failure.line, failure.column]).toEqual([2, 11]);
  });

  test("stops too many alias expansions at an alias", () => {
    const lines = ["formatVersion: 1", "a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level < 8; level += 1) {
      const previous = String.fromCharCode(96 + level);
      const next = String.fromCharCode(97 + level);
      lines.push(`${next}: &${next} [${Array(10).fill(`*${previous}`).join(", ")}]`);
    }
    const failure = failureOf(`${lines.join("\n")}\n`);
    expect(failure.message).toStartWith("The text is not readable YAML.");
    expect(failure.line).toBe(3);
  });

  test("stops a YAML value that is not a mapping", () => {
    const failure = failureOf("- formatVersion\n");
    expect(failure.message).toContain("is not a workflow file");
    expect([failure.line, failure.column]).toEqual([1, 1]);
  });

  test("stops a file without a format version", () => {
    const failure = failureOf("workflow: {}\n");
    expect(failure.message).toContain("has no formatVersion");
    expect([failure.line, failure.column]).toEqual([1, 1]);
  });

  test("stops an unknown format version", () => {
    const failure = failureOf("workflow: {}\nformatVersion: one\n");
    expect(failure.message).toContain("unknown formatVersion");
    expect([failure.line, failure.column]).toEqual([2, 16]);
  });

  test("stops a format version that is newer than the app", () => {
    const failure = failureOf("formatVersion: 2\n");
    expect(failure.message).toContain("newer than this app supports");
    expect([failure.line, failure.column]).toEqual([1, 16]);
  });

  test("stops a value that does not match the format at the value", () => {
    const text = validText().replace("  label: Design flow\n", "  label: 5\n");
    const line = text.split("\n").indexOf("  label: 5") + 1;
    const failure = failureOf(text);
    expect(failure.message).toContain("(at workflow.label)");
    expect([failure.line, failure.column]).toEqual([line, 10]);
  });

  test("stops an unknown key at the key", () => {
    const text = validText().replace("layout:\n", "extra: true\nlayout:\n");
    const line = text.split("\n").indexOf("extra: true") + 1;
    const failure = failureOf(text);
    expect(failure.message).toContain("(at extra)");
    expect([failure.line, failure.column]).toEqual([line, 1]);
  });

  test("stops a missing field at its parent", () => {
    const failure = failureOf("formatVersion: 1\nworkflow: {}\n");
    expect(failure.message).toContain("(at workflow.id)");
    expect([failure.line, failure.column]).toEqual([2, 11]);
  });

  test("keeps references to unknown elements", () => {
    const version = versionFixture();
    version.definition.roles.push({ id: "ghost", writes: ["missing_artifact"] });
    const parsed = parseWorkflowFile(exportWorkflowFile(version, []).text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.file.workflow.roles.at(-1)).toEqual({
      id: "ghost",
      writes: ["missing_artifact"],
    });
  });
});
