import type { CodeViewFileItem, CodeViewItem, CodeViewOptions, FileContents } from "@pierre/diffs";
import type { Editor, EditorOptions } from "@pierre/diffs/edit";
import {
  CodeView as PierreCodeView,
  EditProvider as PierreEditProvider,
  useWorkerPool as usePierreWorkerPool,
} from "@pierre/diffs/react";
import type { CSSProperties, PropsWithChildren, ReactElement } from "react";

type PierreWorkerPoolManager = NonNullable<ReturnType<typeof usePierreWorkerPool>>;

export type TaskExecutionFilePreviewWorkerPool = {
  getFileResultCache: (file: FileContents) => object | undefined;
  isWorkingPool: PierreWorkerPoolManager["isWorkingPool"];
  primeFileHighlightCache: (file: FileContents) => void;
  subscribeToStatChanges: (callback: () => void) => () => void;
};

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

export const useWorkerPool = (): TaskExecutionFilePreviewWorkerPool | undefined =>
  usePierreWorkerPool();
