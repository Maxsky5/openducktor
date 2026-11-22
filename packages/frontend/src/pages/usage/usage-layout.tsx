import type { ReactElement, ReactNode } from "react";

/**
 * The width and padding of the Usage page, also while its chunk loads. This module stays small:
 * the app loads it before the page chunk.
 */
export function UsagePageFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    // The page lays out by its own width, so an open sidebar gives it the narrow layout.
    <div className="@container w-full min-w-0">
      <div className="mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-8 px-4 py-6 @2xl:px-8 @2xl:py-8">
        {children}
      </div>
    </div>
  );
}
