import { type ReactElement, type ReactNode, type Ref, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type BrowserTabsBarProps = {
  children: ReactNode;
  createAction?: ReactNode;
  actions?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  className?: string;
};

export function BrowserTabsBar({
  children,
  createAction,
  actions,
  scrollRef,
  className,
}: BrowserTabsBarProps): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = content?.parentElement;
    if (!content || !viewport) return;

    const revealActiveTab = () => {
      const activeTab = content.querySelector<HTMLElement>(
        '[data-slot="browser-tab"][data-active="true"]',
      );
      if (!activeTab || viewport.clientWidth === 0) return;

      const viewportLeft = viewport.getBoundingClientRect().left + viewport.clientLeft;
      const viewportRight = viewportLeft + viewport.clientWidth;
      const tabRect = activeTab.getBoundingClientRect();
      // A tab wider than the viewport is already as visible as possible when it spans both edges.
      if (tabRect.left < viewportLeft && tabRect.right > viewportRight) return;
      if (tabRect.left < viewportLeft) {
        viewport.scrollLeft += tabRect.left - viewportLeft;
      } else if (tabRect.right > viewportRight) {
        viewport.scrollLeft += Math.min(tabRect.left - viewportLeft, tabRect.right - viewportRight);
      }
    };

    revealActiveTab();
    const mutations = new MutationObserver(revealActiveTab);
    mutations.observe(content, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-active"],
    });
    const resize = new ResizeObserver(revealActiveTab);
    resize.observe(viewport);
    resize.observe(content);
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <div className={cn("shrink-0 bg-muted px-2 pb-0", className)}>
      <div className="flex min-w-0 items-center gap-1 pt-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div ref={scrollRef} className="hide-scrollbar min-w-0 max-w-full overflow-x-auto pt-0.5">
            <div ref={contentRef} className="inline-flex h-8 min-w-max items-center gap-1 pl-1">
              {children}
            </div>
          </div>
          {createAction}
        </div>
        {actions}
      </div>
    </div>
  );
}
