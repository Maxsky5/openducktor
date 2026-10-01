import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps, ReactElement } from "react";

export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>): ReactElement {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}
