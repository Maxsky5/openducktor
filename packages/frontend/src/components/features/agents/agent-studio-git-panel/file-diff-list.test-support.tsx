import { afterAll, afterEach, beforeEach, mock, spyOn } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { act, type ReactElement } from "react";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
} from "@/state/use-inline-comment-draft-store";

export const OWNER_KEY = toInlineCommentDraftStorageKey({
  workspaceId: "workspace-1",
  taskId: "task-1",
});

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const pierreDiffViewerModule = await import("@/components/features/agents/pierre-diff-viewer");
type RestorableSpy = { mockRestore(): void };
let pierreViewerSpies: RestorableSpy[] = [];

const reactActEnvironmentGlobal: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
const previousActEnvironmentValue = reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

export const preloaderMock = mock((_props: { patch: string; filePath: string }) => null);

const fileViewerMock = mock(
  ({ content, filePath }: { content: string; filePath: string; className?: string }) => (
    <div data-testid="pierre-file-viewer" data-content={content} data-file-path={filePath}>
      {content}
    </div>
  ),
);

export const viewerMock = mock(
  ({
    diffStyle,
    filePath,
    diffIndicators,
    heightMode,
    hunkSeparators,
    lineOverflow,
    onLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
  }: {
    diffStyle?: string;
    filePath: string;
    diffIndicators?: string;
    heightMode?: string;
    lineOverflow?: string;
    hunkSeparators?: string;
    onLineSelectionEnd?:
      | ((
          selection: {
            selectedLines: { start: number; end: number; side: "additions"; endSide: "additions" };
            side: "new";
            startLine: number;
            endLine: number;
            codeContext: Array<{ lineNumber: number; text: string; isSelected: boolean }>;
            language: string | null;
          } | null,
        ) => void)
      | undefined;
    lineAnnotations?: Array<{
      side: "additions" | "deletions";
      lineNumber: number;
      metadata: unknown;
    }>;
    renderAnnotation?:
      | ((annotation: {
          side: "additions" | "deletions";
          lineNumber: number;
          metadata: unknown;
        }) => ReactElement | null)
      | undefined;
  }) => (
    <div>
      <div
        data-testid="pierre-diff-viewer"
        data-diff-indicators={diffIndicators ?? ""}
        data-diff-style={diffStyle ?? ""}
        data-height-mode={heightMode ?? ""}
        data-hunk-separators={hunkSeparators ?? ""}
        data-line-overflow={lineOverflow ?? ""}
      >
        {filePath}
      </div>
      <button
        type="button"
        data-testid="pierre-diff-select-lines"
        onClick={() =>
          onLineSelectionEnd?.({
            selectedLines: { start: 2, end: 3, side: "additions", endSide: "additions" },
            side: "new",
            startLine: 2,
            endLine: 3,
            codeContext: [
              { lineNumber: 1, text: "before", isSelected: false },
              { lineNumber: 2, text: "selected one", isSelected: true },
              { lineNumber: 3, text: "selected two", isSelected: true },
            ],
            language: "ts",
          })
        }
      >
        Select lines
      </button>
      <div data-testid="pierre-diff-annotations">
        {(lineAnnotations ?? []).map((annotation) => (
          <div
            key={`${annotation.side}-${annotation.lineNumber}-${JSON.stringify(annotation.metadata)}`}
            data-testid="pierre-diff-annotation"
          >
            {renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    </div>
  ),
);

/** Mocks the Pierre viewers and gives each test an empty inline comment store. */
export function setupFileDiffListTests(): void {
  beforeEach(() => {
    reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;

    resetInlineCommentDraftStoreForTests();
    setInlineCommentDraftStorageForTests(createMemoryStorage());
    setInlineCommentDraftScheduleTaskForTests(() => () => {});

    pierreViewerSpies = [
      spyOn(pierreDiffViewerModule, "PierreDiffPreloader").mockImplementation(
        Object.assign(preloaderMock, {
          $$typeof: pierreDiffViewerModule.PierreDiffPreloader.$$typeof,
          type: preloaderMock,
        }),
      ),
      spyOn(pierreDiffViewerModule, "PierreDiffViewer").mockImplementation(
        Object.assign(viewerMock, {
          $$typeof: pierreDiffViewerModule.PierreDiffViewer.$$typeof,
          type: viewerMock,
        }),
      ),
      spyOn(pierreDiffViewerModule, "PierreFileViewer").mockImplementation(
        Object.assign(fileViewerMock, {
          $$typeof: pierreDiffViewerModule.PierreFileViewer.$$typeof,
          type: fileViewerMock,
        }),
      ),
    ];
  });

  afterEach(() => {
    for (const pierreViewerSpy of pierreViewerSpies) pierreViewerSpy.mockRestore();
    pierreViewerSpies = [];
    cleanup();
    preloaderMock.mockClear();
    viewerMock.mockClear();
    fileViewerMock.mockClear();
    resetInlineCommentDraftStoreForTests();
  });

  afterAll(() => {
    if (previousActEnvironmentValue === undefined) {
      delete reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;
    } else {
      reactActEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironmentValue;
    }
  });
}

/**
 * Fakes the row layout: a closed row is `closedRowHeight` tall, and an expanded row has the expanded height.
 * `resize` reports new sizes to the ResizeObservers and scrolls the list so it renders again.
 * With `clampScroll`, the list stops scrolling at the end of its rows, as in a browser.
 */
export function installMeasuredRows({
  clampScroll = false,
  closedRowHeight = 40,
}: { clampScroll?: boolean; closedRowHeight?: number } = {}) {
  const listHeight = 400;
  const previousResizeObserver = globalThis.ResizeObserver;
  const observers: Array<{
    callback: ResizeObserverCallback;
    elements: Set<Element>;
    observer: ResizeObserver;
  }> = [];
  const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const previousOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  let currentWidth = 600;
  let currentExpandedRowHeight = 800;
  const rowHeight = (element: Element): number =>
    element
      .querySelector('[data-testid="agent-studio-git-file-toggle-button"]')
      ?.getAttribute("aria-expanded") === "true"
      ? currentExpandedRowHeight
      : closedRowHeight;
  if (clampScroll) {
    const elementScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get(this: HTMLElement) {
        return elementScrollTop?.get?.call(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        // react-window sizes the list with an `aria-hidden` element after the rows.
        const rowsElement =
          this.getAttribute("role") === "list"
            ? this.querySelector<HTMLElement>(':scope > [aria-hidden="true"]')
            : null;
        const rowsHeight = rowsElement ? Number.parseFloat(rowsElement.style.height) : Number.NaN;
        const maxScrollTop = Number.isNaN(rowsHeight)
          ? value
          : Math.max(0, rowsHeight - listHeight);
        elementScrollTop?.set?.call(this, Math.min(value, maxScrollTop));
      },
    });
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: function (this: HTMLElement) {
      if (this.getAttribute("role") === "listitem") {
        return rowHeight(this);
      }
      return previousOffsetHeight?.get?.call(this) ?? 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute("role") === "list") return new DOMRect(0, 0, currentWidth, listHeight);
    if (this.getAttribute("role") === "listitem") {
      const rowStart = Number(/translateY\((\d+)px\)/.exec(this.style.transform)?.[1] ?? 0);
      const height = rowHeight(this);
      return new DOMRect(0, rowStart - (this.parentElement?.scrollTop ?? 0), currentWidth, height);
    }
    return previousGetBoundingClientRect.call(this);
  };
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly controller: (typeof observers)[number];

    constructor(callback: ResizeObserverCallback) {
      this.controller = { callback, elements: new Set(), observer: this };
      observers.push(this.controller);
    }

    observe(element: Element): void {
      this.controller.elements.add(element);
    }

    unobserve(element: Element): void {
      this.controller.elements.delete(element);
    }

    disconnect(): void {
      this.controller.elements.clear();
    }
  };

  return {
    resize: (width: number, expandedRowHeight: number, passes = 3) => {
      currentWidth = width;
      currentExpandedRowHeight = expandedRowHeight;
      for (let pass = 0; pass < passes; pass++) {
        act(() => {
          for (const observer of observers) {
            const entries = Array.from(observer.elements, (element) => {
              const isList = element.getAttribute("role") === "list";
              const height = rowHeight(element);
              const boxSize = { blockSize: height, inlineSize: width };
              return {
                target: element,
                contentRect: new DOMRect(0, 0, width, isList ? listHeight : height),
                borderBoxSize: [boxSize],
                contentBoxSize: [boxSize],
                devicePixelContentBoxSize: [boxSize],
              } satisfies ResizeObserverEntry;
            });
            observer.callback(entries, observer.observer);
          }
        });
        for (const observer of observers) {
          for (const element of observer.elements) {
            if (element.getAttribute("role") === "list") fireEvent.scroll(element);
          }
        }
      }
    },
    restore: () => {
      globalThis.ResizeObserver = previousResizeObserver;
      if (clampScroll) {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTop");
      }
      HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect;
      if (previousOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", previousOffsetHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    },
  };
}
