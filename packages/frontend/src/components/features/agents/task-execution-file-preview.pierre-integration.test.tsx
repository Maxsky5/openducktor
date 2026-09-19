import { describe, expect, test } from "bun:test";
import type { CodeViewFileItem, CodeViewItem } from "@pierre/diffs";
import {
  Editor,
  type EditorChangeEvent,
  type EditorFactory,
  type EditorOptions,
  type EditorType,
} from "@pierre/diffs/edit";
import { CodeView, EditProvider } from "@pierre/diffs/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const createTextMetrics = (width: number): TextMetrics => ({
  width,
  actualBoundingBoxAscent: 0,
  actualBoundingBoxDescent: 0,
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: width,
  fontBoundingBoxAscent: 0,
  fontBoundingBoxDescent: 0,
  emHeightAscent: 0,
  emHeightDescent: 0,
  hangingBaseline: 0,
  alphabeticBaseline: 0,
  ideographicBaseline: 0,
});

type PierreEditor = Editor<EditorType, undefined, undefined>;
type PierreEditorOptions = Omit<EditorOptions<EditorType, undefined, undefined>, "onChange">;

type PierreSaveContinuityHarnessProps = {
  onAttach: (editor: PierreEditor) => void;
};

const createPierreEditor: EditorFactory<undefined, undefined> = (
  editorType,
  options,
  editStateKey,
) => new Editor(editorType, options, editStateKey);

function PierreSaveContinuityHarness({ onAttach }: PierreSaveContinuityHarnessProps): ReactElement {
  const [draft, setDraft] = useState("one");
  const [savedContents, setSavedContents] = useState("one");
  const editorOptions = useMemo<PierreEditorOptions>(() => ({ onAttach }), [onAttach]);
  const handleEditChange = useCallback(
    (
      event: EditorChangeEvent<EditorType, undefined, undefined>,
      _item: CodeViewItem<undefined>,
    ) => {
      setDraft(event.file.contents);
    },
    [],
  );
  const items = useMemo<CodeViewFileItem[]>(
    () => [
      {
        id: "file.txt",
        type: "file",
        file: {
          name: "file.txt",
          contents: "one",
          lang: "text",
          cacheKey: "file.txt:revision-1",
        },
        edit: true,
        version: 1,
      },
    ],
    [],
  );

  return (
    <>
      <button type="button" onClick={() => setSavedContents(draft)}>
        Save snapshot {savedContents}
      </button>
      <EditProvider createEditor={createPierreEditor}>
        <CodeView
          items={items}
          options={{ disableFileHeader: true }}
          editorOptions={editorOptions}
          onItemEditChange={handleEditChange}
          disableWorkerPool
        />
      </EditProvider>
    </>
  );
}

describe("Pierre CodeView editor continuity", () => {
  test("keeps the attached editor document, selection, and undo history across Save state", async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const textMeasurementContext: Pick<CanvasRenderingContext2D, "font" | "measureText"> = {
      font: "",
      measureText: (text) => createTextMetrics(text.length * 8),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => textMeasurementContext,
    });
    const attachedEditors: PierreEditor[] = [];
    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(
        <PierreSaveContinuityHarness onAttach={(editor) => attachedEditors.push(editor)} />,
      );
      await waitFor(() => expect(attachedEditors).toHaveLength(1));
      const editor = attachedEditors[0];
      if (!editor) throw new Error("Pierre did not attach an editor.");

      act(() => {
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 },
            },
            newText: "two",
          },
        ]);
      });
      editor.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: "none",
        },
      ]);
      const stateBeforeSave = editor.getViewState();

      fireEvent.click(screen.getByRole("button", { name: "Save snapshot one" }));

      expect(screen.getByRole("button", { name: "Save snapshot two" })).toBeTruthy();
      expect(attachedEditors).toEqual([editor]);
      expect(editor.getText()).toBe("two");
      expect(editor.getViewState()).toEqual(stateBeforeSave);
      expect(editor.canUndo).toBe(true);
      act(() => editor.undo());
      expect(editor.getText()).toBe("one");
    } finally {
      view?.unmount();
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: originalGetContext,
      });
    }
  });
});
