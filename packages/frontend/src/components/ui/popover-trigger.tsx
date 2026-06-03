import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps, ReactElement } from "react";

export function PopoverTrigger(
  props: ComponentProps<typeof PopoverPrimitive.Trigger>,
): ReactElement {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}
