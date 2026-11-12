import type { ComponentProps } from "react";
import { BRAND_PATHS, type BrandName } from "@/lib/brands";

/** A brand logo, in the text color, at the size of a Lucide icon. */
export function BrandIcon({ name, ...props }: { name: BrandName } & ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      {...props}
    >
      <path d={BRAND_PATHS[name]} />
    </svg>
  );
}
