import type { ReactElement } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

export function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps): ReactElement {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}
