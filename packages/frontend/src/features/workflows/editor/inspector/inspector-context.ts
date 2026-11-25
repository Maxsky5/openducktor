import type {
  WorkflowDocument,
  WorkflowLibraryRole,
  WorkflowProblemPath,
} from "@openducktor/contracts";
import {
  formatProblemPath,
  type RenameableElementKind,
  type WorkflowElementKey,
} from "@openducktor/workflows";
import { createContext, useContext } from "react";
import type { EditorActions, EditorChangeOptions } from "../model/editor-store";
import type { ElementOptions } from "./element-options";

/** The role catalog commands of the editor. Role saves apply at once, outside undo. */
export type EditorRoleCommands = {
  readonly newRole: () => void;
  readonly editRole: (roleId: string) => void;
  readonly duplicateRole: (roleId: string) => void;
};

export type InspectorContextValue = {
  readonly readOnly: boolean;
  readonly document: WorkflowDocument;
  /** The selected element. Field paths are relative to it. */
  readonly elementKey: WorkflowElementKey;
  /** The formatted field paths of the element that have a problem. */
  readonly problemPaths: ReadonlySet<string>;
  readonly change: (
    update: (document: WorkflowDocument) => WorkflowDocument,
    options?: EditorChangeOptions,
  ) => void;
  readonly rename: (kind: RenameableElementKind, from: string, to: string) => void;
  /** Adds an element in one undo step and selects it. */
  readonly create: EditorActions["create"];
  readonly select: (key: WorkflowElementKey) => void;
  /** The declared elements that reference fields offer. */
  readonly options: ElementOptions;
  readonly catalogRoles: readonly WorkflowLibraryRole[];
  readonly roles: EditorRoleCommands;
  /** The workflow has a version, so its ID is fixed. */
  readonly published: boolean;
  /** The other workflow IDs of the host. A draft-only workflow cannot take them. */
  readonly takenWorkflowIds: ReadonlySet<string>;
};

export const InspectorContext = createContext<InspectorContextValue | null>(null);

export const useInspector = (): InspectorContextValue => {
  const value = useContext(InspectorContext);
  if (!value) throw new Error("Inspector fields need an InspectorContext provider.");
  return value;
};

/** The attribute value that a problem click looks for to focus a field. */
export const fieldPathAttribute = (path: WorkflowProblemPath): string => formatProblemPath(path);

/** The undo step key of one field: its keystrokes make one step. */
export const fieldCoalesceKey = (element: WorkflowElementKey, path: WorkflowProblemPath): string =>
  `${element}|${formatProblemPath(path)}`;
