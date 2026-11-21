import type { WorkflowLibraryRole } from "@openducktor/contracts";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorRoleCommands } from "./inspector/inspector-context";
import type { EditorView, SharedStateDisplay } from "./model/editor-derivation";
import type { EditorActions, EditorState, EditorStore } from "./model/editor-store";

/** What every panel of one open editor shares. */
export type EditorEnvironment = {
  readonly store: EditorStore;
  /**
   * The derivation of a store snapshot. It derives each document once, so panels read slices of
   * it through `useEditorView` and render again only when their slice changes.
   */
  readonly viewOf: (state: EditorState) => EditorView;
  readonly catalogRoles: readonly WorkflowLibraryRole[];
  readonly roles: EditorRoleCommands;
  /** The workflow has a version, so its ID is fixed. */
  readonly published: boolean;
  readonly takenWorkflowIds: ReadonlySet<string>;
  /** The display of each state ID of the other custom workflows. A new state copies it. */
  readonly sharedStates: ReadonlyMap<string, SharedStateDisplay>;
};

export const EditorContext = createContext<EditorEnvironment | null>(null);

export const useEditor = (): EditorEnvironment => {
  const value = useContext(EditorContext);
  if (!value) throw new Error("Editor panels need an EditorContext provider.");
  return value;
};

export const useEditorState = <Selected>(
  select: (state: EditorState & EditorActions) => Selected,
): Selected => useStore(useEditor().store, select);

/** A slice of the derived view. The panel renders again only when the slice changes. */
export const useEditorView = <Selected>(select: (view: EditorView) => Selected): Selected => {
  const { store, viewOf } = useEditor();
  return useStore(store, (state) => select(viewOf(state)));
};
