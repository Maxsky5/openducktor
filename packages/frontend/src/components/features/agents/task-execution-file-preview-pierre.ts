import type { CodeViewFileItem, CodeViewItem, CodeViewOptions, FileContents } from "@pierre/diffs";
import type {
  EditorChangeEvent,
  EditorFactory,
  EditorOptions,
  EditorType,
} from "@pierre/diffs/edit";
import {
  CodeView as PierreCodeView,
  EditProvider as PierreEditProvider,
} from "@pierre/diffs/react";
import {
  createElement,
  type CSSProperties,
  type PropsWithChildren,
  type ReactElement,
} from "react";

export { useWorkerPool } from "@pierre/diffs/react";

export type TaskExecutionEditorOptions = Omit<
  EditorOptions<EditorType, undefined, undefined>,
  "onChange"
>;

export type TaskExecutionCodeViewProps = {
  className?: string;
  style?: CSSProperties;
  items: CodeViewFileItem[];
  options?: CodeViewOptions<undefined, undefined>;
  editorOptions?: TaskExecutionEditorOptions;
  onItemEditChange?: (item: CodeViewItem<undefined>, file: FileContents) => void;
};

type TaskExecutionEditProviderProps = PropsWithChildren<{
  createEditor: EditorFactory<undefined, undefined>;
}>;

export const CodeView = ({
  onItemEditChange,
  ...props
}: TaskExecutionCodeViewProps): ReactElement =>
  createElement(PierreCodeView<undefined, undefined>, {
    ...props,
    onItemEditChange: (
      event: EditorChangeEvent<EditorType, undefined, undefined>,
      item: CodeViewItem<undefined>,
    ): void => {
      onItemEditChange?.(item, event.file);
    },
  });

export const EditProvider: (props: TaskExecutionEditProviderProps) => ReactElement =
  PierreEditProvider<undefined, undefined>;
