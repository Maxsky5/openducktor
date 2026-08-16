import type { ReactElement } from "react";
import { FolderPickerDialogSession } from "./folder-picker-dialog-session";
import type { FolderPickerCommonProps } from "./use-folder-picker-controller";

type FolderPickerDialogProps = FolderPickerCommonProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const getFolderPickerSessionKey = ({
  initialPath,
  open,
}: {
  initialPath: string | undefined;
  open: boolean;
}): string => `${open ? "open" : "closed"}\0${initialPath ?? ""}`;

export function FolderPickerDialog(props: FolderPickerDialogProps): ReactElement {
  return (
    <FolderPickerDialogSession
      key={getFolderPickerSessionKey({ initialPath: props.initialPath, open: props.open })}
      {...props}
    />
  );
}
