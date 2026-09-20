import { cn } from "@/lib/utils";

export const browserTabLabelClassName =
  "h-7 max-w-[19rem] cursor-pointer items-center justify-start gap-2 rounded-t-[8px] border-none bg-transparent px-0 pr-1 text-sm font-medium leading-none text-inherit";

export function browserTabShellClassName(active: boolean): string {
  return cn(
    "group relative z-1 inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-[10px] pl-2 pr-1",
    active
      ? "z-10 border-input border-b-transparent bg-card text-foreground hover:bg-card after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-card"
      : "border-input border-b-input bg-secondary text-foreground hover:bg-muted",
  );
}
