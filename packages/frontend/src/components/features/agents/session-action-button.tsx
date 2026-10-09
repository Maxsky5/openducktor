import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SessionActionVariant = "default" | "outline";

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  /** The filled default marks the main session action. Outline marks a secondary one. */
  variant?: SessionActionVariant;
};

const menuTriggerBorderClassNames = {
  default: "border-l border-primary-foreground/25",
  outline: "border-l-0",
} satisfies Record<SessionActionVariant, string>;

export function SessionActionButton({
  className,
  variant = "default",
  ...props
}: ActionButtonProps): ReactElement {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={cn("h-7 max-w-44 gap-1.5 rounded-r-none px-2.5 text-xs shadow-none", className)}
      {...props}
    />
  );
}

export function SessionActionMenuTrigger({
  className,
  variant = "default",
  ...props
}: Omit<ActionButtonProps, "children">): ReactElement {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={cn(
        "h-7 rounded-l-none px-1.5 shadow-none",
        menuTriggerBorderClassNames[variant],
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-3 opacity-80" aria-hidden="true" />
    </Button>
  );
}
