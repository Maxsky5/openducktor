import type { ReactElement } from "react";
import { ConfirmDialogHost } from "@/ui/confirm-dialog";

/**
 * The `screenLayout` of each stack. It gives every screen its own confirmation dialog, so the
 * dialog opens over the screen that asks, also when that screen is a sheet.
 */
export const screenLayout = ({ children }: { children: ReactElement }): ReactElement => (
  <ConfirmDialogHost>{children}</ConfirmDialogHost>
);
