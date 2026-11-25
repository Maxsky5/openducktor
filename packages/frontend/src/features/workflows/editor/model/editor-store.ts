import type {
  WorkflowCanvasLayout,
  WorkflowDocument,
  WorkflowProblem,
  WorkflowProblemPath,
} from "@openducktor/contracts";
import {
  elementKey,
  parseElementKey,
  type RenameableElementKind,
  renameWorkflowElement,
  type WorkflowElementKey,
} from "@openducktor/workflows";
import { createStore, type StoreApi } from "zustand/vanilla";
import { placeNewState } from "./canvas-layout";
import { elementExists } from "./document-elements";
import { deleteElement, isDeletable, withBuiltinStateFields } from "./document-edits";
import { createDraftAutosave, type SaveStatus } from "./draft-autosave";

/** The selected element, and the field that a problem click asks to focus. */
type EditorSelection = {
  readonly key: WorkflowElementKey;
  readonly fieldPath: WorkflowProblemPath;
  /** Changes on each focus request, so the same field can take the focus again. */
  readonly focusRequest: number;
  /**
   * Changes when the selection moves to another element. A rename keeps it, so the details of the
   * renamed element keep their state and their focus.
   */
  readonly instance: number;
};

export type EditorChangeOptions = {
  /**
   * Consecutive changes with the same key make one undo step, such as the keystrokes of one
   * field. Any other change, undo, or redo ends the step.
   */
  readonly coalesceKey?: string;
};

export type EditorState = {
  /** The host ID of the workflow. A draft save of a renamed draft-only workflow changes it. */
  readonly workflowId: string;
  readonly readOnly: boolean;
  readonly document: WorkflowDocument;
  readonly past: readonly WorkflowDocument[];
  readonly future: readonly WorkflowDocument[];
  readonly coalesceKey: string | null;
  /**
   * The box positions of this editor session: the opening layout of the states without a saved
   * position, Auto layout, and drags. They go over the saved layout, and they are never saved.
   */
  readonly viewPositions: WorkflowCanvasLayout["states"];
  readonly selection: EditorSelection | null;
  /**
   * The element under the pointer in the element list or on the canvas. The canvas lights up
   * what it links, as it does for the selection. View state only.
   */
  readonly hoverKey: WorkflowElementKey | null;
  /** Whether the host has a draft of this workflow. The first save of a version creates it. */
  readonly hasDraft: boolean;
  readonly save: SaveStatus;
  /** Problems that the host found at publication. They replace the live problems of the document. */
  readonly hostProblems: {
    readonly document: WorkflowDocument;
    readonly problems: readonly WorkflowProblem[];
  } | null;
  /** The element that waits for the user to confirm its delete. */
  readonly deleteRequest: WorkflowElementKey | null;
};

export type EditorActions = {
  change(
    update: (document: WorkflowDocument) => WorkflowDocument,
    options?: EditorChangeOptions,
  ): void;
  /** Adds an element in one undo step and selects it. */
  create(
    make: (document: WorkflowDocument) => { document: WorkflowDocument; key: WorkflowElementKey },
  ): void;
  /** Deletes a deletable element in one undo step. A selection of the element clears. */
  remove(key: WorkflowElementKey): void;
  /** Asks the user to confirm the delete of a deletable element. Null drops the request. */
  requestRemove(key: WorkflowElementKey | null): void;
  /** Changes an element ID and every reference to it. The selection follows the element. */
  rename(kind: RenameableElementKind, from: string, to: string): void;
  undo(): void;
  redo(): void;
  select(key: WorkflowElementKey | null, fieldPath?: WorkflowProblemPath): void;
  /** Moves boxes for this editor session only. Box positions are not saved. */
  setPositions(positions: WorkflowCanvasLayout["states"]): void;
  hover(key: WorkflowElementKey | null): void;
  retrySave(): void;
  /** Starts the save of the last edit now, without the pause that autosave waits for. */
  flushSave(): void;
  /**
   * Saves the last edit now and resolves once the host has the draft, so a publication never
   * misses an edit. It rejects with the reason when the save fails.
   */
  saveNow(): Promise<void>;
  setHostProblems(problems: readonly WorkflowProblem[]): void;
};

export type EditorStore = StoreApi<EditorState & EditorActions>;

export type EditorSeed = {
  readonly workflowId: string;
  readonly document: WorkflowDocument;
  readonly readOnly: boolean;
  readonly hasDraft: boolean;
  readonly viewPositions: WorkflowCanvasLayout["states"];
};

export type EditorStoreDependencies = {
  /** Saves the draft. It resolves with the workflow ID that the host keeps. */
  readonly saveDraft: (
    workflowId: string,
    document: WorkflowDocument,
  ) => Promise<{ workflowId: string }>;
  /** A save of a renamed draft-only workflow gives it a new host ID. */
  readonly onWorkflowIdChange?: (workflowId: string) => void;
};

/** Undo keeps this many steps. */
const UNDO_LIMIT = 200;

/** One store per open editor. TanStack Query keeps only the host reads. */
export const createEditorStore = (
  seed: EditorSeed,
  { saveDraft, onWorkflowIdChange }: EditorStoreDependencies,
): EditorStore =>
  createStore<EditorState & EditorActions>()((set, get, api) => {
    const autosave = createDraftAutosave({
      save: async (document) => {
        const previous = get().workflowId;
        const { workflowId } = await saveDraft(previous, document);
        set({ workflowId, hasDraft: true });
        if (workflowId !== previous) onWorkflowIdChange?.(workflowId);
      },
      onStatus: (save) => set({ save }),
    });

    // The selection of each document version, so undo and redo can follow a rename back.
    const selectedAt = new WeakMap<WorkflowDocument, WorkflowElementKey | null>();

    const commit = (
      document: WorkflowDocument,
      past: readonly WorkflowDocument[],
      future: readonly WorkflowDocument[],
      coalesceKey: string | null,
      // Undo and redo go back to a version that keeps the selection it had.
      remember = true,
    ) => {
      set({ document, past: past.slice(-UNDO_LIMIT), future, coalesceKey });
      if (remember) selectedAt.set(document, get().selection?.key ?? null);
      autosave.push(document);
    };

    /**
     * The selection after undo or redo: the same element while it exists, else the element that
     * was selected with that version, else none. The details keep their state.
     */
    const restoreSelection = (target: WorkflowDocument) => {
      const selection = get().selection;
      if (selection === null || elementExists(target, selection.key)) return;
      const remembered = selectedAt.get(target) ?? null;
      set({
        selection:
          remembered !== null && elementExists(target, remembered)
            ? { ...selection, key: remembered }
            : null,
      });
    };

    return {
      workflowId: seed.workflowId,
      readOnly: seed.readOnly,
      document: seed.document,
      past: [],
      future: [],
      coalesceKey: null,
      viewPositions: seed.viewPositions,
      selection: null,
      hoverKey: null,
      hasDraft: seed.hasDraft,
      save: { status: "saved" },
      hostProblems: null,
      deleteRequest: null,

      change: (update, options = {}) => {
        const state = get();
        if (state.readOnly) return;
        // A state or notification that the built-in workflow uses takes its built-in fields.
        const document = withBuiltinStateFields(update(state.document));
        if (document === state.document) return;
        // The version that this edit leaves keeps its latest selection for an undo.
        selectedAt.set(state.document, state.selection?.key ?? null);
        const coalesceKey = options.coalesceKey ?? null;
        const joins = coalesceKey !== null && coalesceKey === state.coalesceKey;
        commit(document, joins ? state.past : [...state.past, state.document], [], coalesceKey);
      },

      create: (make) => {
        let key: WorkflowElementKey | null = null;
        get().change((document) => {
          const created = make(document);
          key = created.key;
          return created.document;
        });
        if (key === null) return;
        // A new state gets its box in this session, since box positions are not saved.
        const { kind, id } = parseElementKey(key);
        const { document, viewPositions } = get();
        const placed = { ...document.layout.states, ...viewPositions };
        if (kind === "state" && !Object.hasOwn(placed, id))
          set({ viewPositions: { ...viewPositions, ...placeNewState(placed, id) } });
        get().select(key);
      },

      remove: (key) => {
        if (get().readOnly || !isDeletable(key)) return;
        get().change((document) => deleteElement(document, key));
        if (get().selection?.key === key) set({ selection: null });
      },

      requestRemove: (key) => {
        if (key !== null && (get().readOnly || !isDeletable(key))) return;
        set({ deleteRequest: key });
      },

      rename: (kind, from, to) => {
        if (from === to) return;
        get().change((document) => renameWorkflowElement(document, kind, from, to));
        // The box keeps its place under the new ID.
        const { viewPositions } = get();
        if (kind === "state" && Object.hasOwn(viewPositions, from)) {
          const { [from]: position, ...others } = viewPositions;
          set({ viewPositions: { ...others, [to]: position! } });
        }
        const selection = get().selection;
        if (selection?.key === elementKey(kind, from)) {
          set({ selection: { ...selection, key: elementKey(kind, to) } });
          selectedAt.set(get().document, elementKey(kind, to));
        }
      },

      undo: () => {
        const state = get();
        const previous = state.past.at(-1);
        if (state.readOnly || !previous) return;
        commit(previous, state.past.slice(0, -1), [state.document, ...state.future], null, false);
        restoreSelection(previous);
      },

      redo: () => {
        const state = get();
        const [next, ...future] = state.future;
        if (state.readOnly || !next) return;
        commit(next, [...state.past, state.document], future, null, false);
        restoreSelection(next);
      },

      select: (key, fieldPath) => {
        const previous = get().selection;
        // Edits of another element start a new undo step.
        if (previous?.key !== key) set({ coalesceKey: null });
        set({
          selection:
            key === null
              ? null
              : {
                  key,
                  fieldPath: fieldPath ?? [],
                  focusRequest: (previous?.focusRequest ?? 0) + (fieldPath ? 1 : 0),
                  instance:
                    previous?.key === key ? previous.instance : (previous?.instance ?? 0) + 1,
                },
        });
      },

      hover: (key) => {
        if (get().hoverKey !== key) set({ hoverKey: key });
      },

      setPositions: (positions) => {
        const rounded = Object.fromEntries(
          Object.entries(positions).map(([id, { x, y }]) => [
            id,
            { x: Math.round(x), y: Math.round(y) },
          ]),
        );
        set({ viewPositions: { ...get().viewPositions, ...rounded } });
      },

      retrySave: () => autosave.retry(),

      flushSave: () => autosave.flush(),

      saveNow: () => {
        autosave.flush();
        // The save status event of the store tells when the save ends.
        return new Promise<void>((resolve, reject) => {
          const settle = ({ save }: EditorState): boolean => {
            if (save.status === "saving") return false;
            if (save.status === "saved") resolve();
            else reject(new Error(`The draft did not save. ${save.message}`));
            return true;
          };
          if (settle(get())) return;
          const unsubscribe = api.subscribe((state) => {
            if (settle(state)) unsubscribe();
          });
        });
      },

      setHostProblems: (problems) => set({ hostProblems: { document: get().document, problems } }),
    };
  });
