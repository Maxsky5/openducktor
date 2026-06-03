import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps, ReactElement } from "react";

export function CollapsibleTrigger(
  props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>,
): ReactElement {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}
