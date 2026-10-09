import type { CodeViewFileItem, CodeViewItem, CodeViewOptions, FileContents } from "@pierre/diffs";
import { Editor, type EditorFactory, type EditorType } from "@pierre/diffs/edit";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useLayoutEffect,
  useMemo,
} from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { getShellBridge } from "@/lib/shell-bridge";
import {
  CodeView,
  EditProvider,
  type TaskExecutionEditorOptions,
} from "./task-execution-file-preview-pierre";

export type CodeViewFile = {
  id: string;
  file: FileContents;
  numberColumnWidth: string;
};

type TaskExecutionFileCodeViewProps = {
  file: CodeViewFile;
  editable: boolean;
  version: number;
  editorRef: RefObject<Editor<EditorType, undefined, undefined> | null>;
  onItemEditChange(item: CodeViewItem<undefined>, file: FileContents): void;
};

export function TaskExecutionFileCodeView({
  file,
  editable,
  version,
  editorRef,
  onItemEditChange,
}: TaskExecutionFileCodeViewProps): ReactElement {
  const { theme } = useTheme();
  const options = useMemo<CodeViewOptions<undefined, undefined>>(
    () => ({
      theme: THEME,
      themeType: theme,
      overflow: "wrap",
      disableFileHeader: true,
      itemMetrics: {
        lineHeight: LINE_HEIGHT,
        spacing: PADDING,
        paddingTop: PADDING,
        paddingBottom: PADDING,
      },
      layout: {
        paddingTop: 0,
        paddingBottom: 0,
        gap: 0,
      },
      unsafeCSS: GUTTER_CSS,
    }),
    [theme],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      ...BASE_STYLE,
      "--file-preview-number-column-width": file.numberColumnWidth,
      backgroundColor: "var(--diffs-bg)",
      colorScheme: theme,
    }),
    [theme, file.numberColumnWidth],
  );
  const editorOptions = useMemo<TaskExecutionEditorOptions>(() => {
    const clipboard = getShellBridge().editorClipboard;
    const editorOptions: TaskExecutionEditorOptions = {
      onAttach(attachedEditor) {
        editorRef.current = attachedEditor;
        attachedEditor.focus({ lineNumber: "first-visible", preventScroll: true });
      },
    };
    if (clipboard) {
      editorOptions.clipboard = clipboard;
    }
    return editorOptions;
  }, [editorRef]);

  const items = useMemo<CodeViewFileItem[]>(
    () => [{ id: file.id, type: "file", file: file.file, edit: editable, version }],
    [editable, file, version],
  );
  useLayoutEffect(
    () => () => {
      editorRef.current = null;
    },
    [editorRef],
  );
  return (
    <EditProvider createEditor={createEditor}>
      <CodeView
        className="h-full min-h-0 overflow-auto"
        style={style}
        items={items}
        options={options}
        editorOptions={editorOptions}
        onItemEditChange={onItemEditChange}
      />
    </EditProvider>
  );
}

const THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const BACKGROUNDS = { dark: "#0a0a0a", light: "#ffffff" } as const;
const LINE_HEIGHT = 18;
const PADDING = 8;
const createEditor: EditorFactory<undefined, undefined> = (editorType, options, editStateKey) =>
  new Editor(editorType, options, editStateKey);
type CodeViewCssProperties = CSSProperties & Record<`--diffs-${string}`, string | number>;
const BASE_STYLE: CodeViewCssProperties = {
  "--diffs-light-bg": BACKGROUNDS.light,
  "--diffs-dark-bg": BACKGROUNDS.dark,
  "--diffs-bg": "light-dark(var(--diffs-light-bg), var(--diffs-dark-bg))",
  "--diffs-font-size": "12px",
  "--diffs-line-height": `${LINE_HEIGHT}px`,
  "--diffs-gap-block": `${PADDING}px`,
  "--diffs-scrollbar-gutter-override": "0px",
  "--diffs-tab-size": 2,
};

const GUTTER_CSS = `
[data-column-number],
[data-gutter-buffer] {
  padding-left: 0.5ch;
  padding-right: 0.75ch;
}

[data-file] {
  --diffs-grid-number-column-width: var(--file-preview-number-column-width);
}
`;
