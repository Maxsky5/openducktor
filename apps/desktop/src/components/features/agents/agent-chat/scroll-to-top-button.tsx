import { ArrowUp } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScrollToTopButtonProps = {
  onClick: () => void;
  visible: boolean;
};

export function ScrollToTopButton({ onClick, visible }: ScrollToTopButtonProps): ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2 transition-opacity duration-200",
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
        aria-label="Scroll to top"
      >
        <ArrowUp className="size-4" />
      </Button>
    </div>
  );
}
