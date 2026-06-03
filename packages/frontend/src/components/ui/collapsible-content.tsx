import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps, ReactElement } from "react";

export function CollapsibleContent(
  props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>,
): ReactElement {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />;
}
