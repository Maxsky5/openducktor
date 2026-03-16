import { ArrowDown } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScrollToBottomButtonProps = {
  onClick: () => void;
  visible: boolean;
};

export function ScrollToBottomButton({
  onClick,
  visible,
}: ScrollToBottomButtonProps): ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 transition-opacity duration-200",
        visible && "pointer-events-auto opacity-100",
        !visible && "opacity-0",
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-9 rounded-full border-border bg-card text-muted-foreground shadow-md hover:bg-accent hover:text-foreground"
        onClick={onClick}
        aria-label="Scroll to bottom"
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
