import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps, ReactElement } from "react";

export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>): ReactElement {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}
