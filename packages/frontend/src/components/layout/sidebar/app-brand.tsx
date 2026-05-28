import type { CSSProperties, ReactElement } from "react";
import openducktorMarkUrl from "@/assets/openducktor-mark.svg";
import { getAppVersion } from "@/lib/app-version";

const APP_VERSION = getAppVersion();
const OPENDUCKTOR_MARK_MASK_STYLE: CSSProperties = {
  WebkitMaskImage: `url(${openducktorMarkUrl})`,
  maskImage: `url(${openducktorMarkUrl})`,
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

export function AppBrand(): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span
        className="block size-10 shrink-0 bg-sidebar-brand-mark"
        style={OPENDUCKTOR_MARK_MASK_STYLE}
        aria-hidden="true"
      />
      <div>
        <p className="text-lg font-semibold tracking-tight">OpenDucktor</p>
        {APP_VERSION && <p className="text-xs text-sidebar-muted-foreground">{APP_VERSION}</p>}
      </div>
    </div>
  );
}
