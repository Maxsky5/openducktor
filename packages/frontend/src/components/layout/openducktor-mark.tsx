import type { ReactElement } from "react";
import openducktorMarkUrl from "@/assets/openducktor-mark.svg";
import { cn } from "@/lib/utils";

type OpenDucktorMarkProps = {
  className: string;
};

// The mark keeps the violet tile of the app icon in both themes.
export function OpenDucktorMark({ className }: OpenDucktorMarkProps): ReactElement {
  return <img src={openducktorMarkUrl} alt="" className={cn("block shrink-0", className)} />;
}
