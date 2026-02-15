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
            "group border border-slate-200 bg-white/95 text-slate-900 shadow-xl shadow-slate-900/10 backdrop-blur",
          content: "gap-1.5",
          title: "text-sm font-semibold",
          description: "text-xs text-slate-600",
          icon: "text-slate-500",
          closeButton:
            "!left-auto !right-3 !top-1/2 !mt-[-12px] !translate-x-0 !translate-y-0 !transform-none size-6 rounded-md border border-slate-200 bg-white text-slate-500 opacity-0 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:opacity-100 group-hover:opacity-100",
          actionButton:
            "bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/40",
          cancelButton:
            "bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400/40",
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
