import type { ReactElement } from "react";
import { Screen } from "@/ui/screen";
import { SheetScreen, type SheetScreenProps } from "./sheet-screen";

/**
 * A route sheet on the grouped background: the sheet header with its close control, the
 * connection status, and the content. While an action runs (`closable={false}`), neither the
 * close control, the swipe gesture, nor Android Back closes the sheet.
 */
export function GroupedSheet({
  closable = true,
  children,
  ...sheet
}: SheetScreenProps): ReactElement {
  return (
    <SheetScreen {...sheet} closable={closable}>
      <Screen background="sheet">{children}</Screen>
    </SheetScreen>
  );
}
