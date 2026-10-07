import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "variant" | "size">;

export function SessionActionButton({ className, ...props }: ActionButtonProps): ReactElement {
  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      className={cn("h-7 max-w-44 gap-1.5 rounded-r-none px-2.5 text-xs shadow-none", className)}
      {...props}
    />
  );
}

export function SessionActionMenuTrigger({
  className,
  ...props
}: Omit<ActionButtonProps, "children">): ReactElement {
  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      className={cn(
        "h-7 rounded-l-none border-l border-primary-foreground/25 px-1.5 shadow-none",
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-3 opacity-80" aria-hidden="true" />
    </Button>
  );
}
