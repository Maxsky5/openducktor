import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <DismissableLayerBranch>
      <Sonner
        position="bottom-right"
        richColors={false}
        closeButton
        expand
        visibleToasts={5}
        toastOptions={{
          classNames: {
            toast:
              "group border border-border bg-card/95 text-foreground shadow-xl shadow-foreground/10 backdrop-blur",
            content: "gap-1.5 pr-7",
            title: "text-sm font-semibold",
            description: "whitespace-pre-wrap break-words text-xs text-muted-foreground",
            icon: "text-muted-foreground",
            closeButton:
              "!left-auto !right-3 !top-3 !mt-0 !translate-x-0 !translate-y-0 !transform-none size-6 rounded-md border border-border bg-card text-muted-foreground opacity-100 transition hover:bg-accent hover:text-foreground",
            actionButton:
              "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40",
            cancelButton:
              "bg-muted text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40",
            success: "border-l-4 border-l-success-accent [&_[data-icon]]:text-success-accent",
            error: "border-l-4 border-l-destructive-accent [&_[data-icon]]:text-destructive-accent",
            warning: "border-l-4 border-l-warning-accent [&_[data-icon]]:text-warning-accent",
            info: "border-l-4 border-l-info-accent [&_[data-icon]]:text-info-accent",
          },
        }}
        {...props}
      />
    </DismissableLayerBranch>
  );
}
