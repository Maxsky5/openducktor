import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
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
          content: "gap-1.5",
          title: "text-sm font-semibold",
          description: "text-xs text-muted-foreground",
          icon: "text-muted-foreground",
          closeButton:
            "!left-auto !right-3 !top-1/2 !mt-[-12px] !translate-x-0 !translate-y-0 !transform-none size-6 rounded-md border border-border bg-card text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
          actionButton:
            "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40",
          cancelButton:
            "bg-muted text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40",
          success: "border-l-4 border-l-emerald-500 [&_[data-icon]]:text-emerald-600",
          error: "border-l-4 border-l-rose-500 [&_[data-icon]]:text-rose-600",
          warning: "border-l-4 border-l-amber-500 [&_[data-icon]]:text-amber-600",
          info: "border-l-4 border-l-sky-500 [&_[data-icon]]:text-sky-600",
        },
      }}
      {...props}
    />
  );
}
