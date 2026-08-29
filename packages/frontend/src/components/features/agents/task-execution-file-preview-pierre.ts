import type { CodeViewFileItem, CodeViewItem, CodeViewOptions, FileContents } from "@pierre/diffs";
import type { Editor, EditorOptions } from "@pierre/diffs/edit";
import {
  CodeView as PierreCodeView,
  EditProvider as PierreEditProvider,
} from "@pierre/diffs/react";
import type { CSSProperties, PropsWithChildren, ReactElement } from "react";

export { useWorkerPool } from "@pierre/diffs/react";

export type TaskExecutionCodeViewProps = {
  className?: string;
  style?: CSSProperties;
  items: CodeViewFileItem[];
  options?: CodeViewOptions<undefined>;
  editorOptions?: EditorOptions<undefined>;
  onItemEditChange?: (item: CodeViewItem<undefined>, file: FileContents) => void;
};

type TaskExecutionEditProviderProps = PropsWithChildren<{
  createEditor: (options: EditorOptions<undefined>) => Editor<undefined>;
}>;

export const CodeView: (props: TaskExecutionCodeViewProps) => ReactElement =
  PierreCodeView<undefined>;
export const EditProvider: (props: TaskExecutionEditProviderProps) => ReactElement =
  PierreEditProvider<undefined>;
