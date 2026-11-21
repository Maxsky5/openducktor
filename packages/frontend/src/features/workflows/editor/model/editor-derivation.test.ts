import { describe, expect, test } from "bun:test";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { newWorkflowDocument } from "@openducktor/workflows";
import { addAction, addEvent, addState } from "./create-elements";
import { updateElement } from "./document-edits";
import { deriveEditorView, type EditorCheckContext } from "./editor-derivation";

const CONTEXT: EditorCheckContext = {
  roles: builtinCompiledCatalogFixture.roles,
  otherWorkflows: [],
  takenWorkflowIds: new Set(),
  sharedStateIds: new Set(),
  sharedStates: new Map(),
};

describe("element names", () => {
  test("name each element as the editor does, so a problem message never shows an ID", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Fixing").document;
    document = addEvent(document, "open", "fixing", "start-fix").document;
    document = updateElement(
      document,
      "event",
      "start-fix",
      ({ label: _label, ...event }) => event,
    );
    document = addAction(document, "Fix it", "event").document;
    const { elementNames } = deriveEditorView(document, CONTEXT, {
      check: true,
      hostProblems: null,
    });
    expect(elementNames.get("fixing")).toBe("Fixing");
    expect(elementNames.get("open")).toBe("Backlog");
    expect(elementNames.get("start_fix")).toBe("Move to Fixing");
    expect(elementNames.get("fix_it")).toBe("Fix it");
  });
});
