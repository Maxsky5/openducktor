import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A radio option as a card, in a `RadioGroup`. A selected card keeps its surface: the brand border
 * and a filled check mark it. Put an `OptionCardMark` in the card.
 */
function OptionCard({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="option-card"
      className={cn(
        "group min-w-0 rounded-lg border border-input text-left outline-none transition-colors data-[state=unchecked]:hover:border-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input dark:data-[state=unchecked]:hover:border-foreground/40 data-[state=checked]:border-primary-emphasis",
        className,
      )}
      {...props}
    />
  );
}

/** The selection mark of an option card: a circle that fills with a check when the card is on. */
function OptionCardMark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground text-transparent transition-colors group-data-[state=checked]:border-primary-emphasis group-data-[state=checked]:bg-primary-emphasis group-data-[state=checked]:text-primary-foreground",
        className,
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

export { OptionCard, OptionCardMark };
