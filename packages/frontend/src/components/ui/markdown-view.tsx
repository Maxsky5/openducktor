/**
 * The Markdown view of the app. `@pierre/words` parses and renders the text into its own DOM, so a
 * long document or a streamed reply renders in a fraction of a millisecond. The view adds what
 * Words leaves to the app: link and diagram clicks, task checkboxes, and images that the host loads.
 */
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { PluginConfig } from "@pierre/words/html";
import { Markdown, type ReactiveIslands } from "@pierre/words/react";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useOnSessionViewHide } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { openClickedLink } from "@/lib/link-open";
import { revealElement } from "@/lib/reveal-element";
import { useOpenExternalUrl } from "@/lib/open-external-url";
import { useShellPlatform } from "@/lib/shell-platform";
import { cn } from "@/lib/utils";
import { Dialog } from "./dialog";
import { useDialogPresence } from "./dialog-presence";
import { mayHaveCodeFence, useCodeHighlighter } from "./markdown-code";
import {
  createDiagramRenderer,
  DIAGRAM_ATTRIBUTE,
  mayHaveDiagram,
  useDiagramRenderer,
} from "./markdown-diagram";
import {
  type HostImageOptions,
  isHostImage,
  MarkdownHostImage,
  type MarkdownImageSource,
} from "./markdown-host-image";
import {
  createMarkdownHooks,
  createMarkdownUrlTransform,
  HOST_IMAGE_ISLAND,
  LOCAL_LINK_ATTRIBUTE,
  type MarkdownLinks,
  parseHostImageData,
} from "./markdown-html";
import { MarkdownMermaidDialog } from "./markdown-mermaid-dialog";
import { MARKDOWN_CLASSES, type MarkdownRendererVariant } from "./markdown-variants";

/** How the images of a view show. `label` shows each image as a chip with its text. */
export type MarkdownImages = "label" | MarkdownImageSource;

export type MarkdownViewProps = {
  markdown: string;
  /** True while the text grows at its end. Words then completes unfinished syntax. */
  streaming: boolean;
  variant: MarkdownRendererVariant;
  className?: string | undefined;
  /** Shows math and diagram fences as text, for short previews. */
  lightweight: boolean;
  links?: MarkdownLinks | undefined;
  images?: MarkdownImages | undefined;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId"> | undefined;
};

/*
 * Words formats in place only without hooks, plugins, and a URL hook, so each one is on only when
 * the text can use it. These checks are cheap, and each can be wrong only one way.
 */
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/m;
const IMAGE = /!\[[^\]\n]*\][([]/;
/** An inline link or a link reference. A local path cannot be a bare autolink. */
const LINK = /\]\(|\]:/;

const showOpenFailure = (cause: unknown): void => {
  toast.error("Failed to open link", { description: errorMessage(cause) });
};

type LinkEvent = MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>;

/** The link of the view that an event targets. */
const closestLink = (event: LinkEvent): HTMLAnchorElement | null => {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  return anchor && event.currentTarget.contains(anchor) ? anchor : null;
};

/**
 * Reveals the target of an in-page link, such as a footnote, without a route change. Words writes
 * the ids of footnotes as they appear in their links.
 */
const scrollToFragment = (href: string): void => {
  const target = document.getElementById(href.slice(1));
  if (target) revealElement(target);
};

type DiagramPreview = { svg: string; open: boolean };

/**
 * Closes the diagram preview when the session view hides, because the dialog sits outside the
 * hidden view. It mounts with a view that shows diagrams, so the views without diagrams do not
 * watch the session view.
 */
function ClosesOnViewHide({ onHide }: { onHide: () => void }): null {
  useOnSessionViewHide(onHide);
  return null;
}

function DiagramPreviewDialog({
  preview,
  onClose,
}: {
  preview: DiagramPreview;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog open={preview.open} onOpenChange={(open) => !open && onClose()}>
      <MarkdownMermaidDialog svg={preview.svg} />
    </Dialog>
  );
}

export const MarkdownView = memo(function MarkdownView({
  markdown,
  streaming,
  variant,
  className,
  lightweight,
  links,
  images,
  taskAssetContext,
}: MarkdownViewProps): ReactElement {
  const { resolveTaskAssetSource } = useShellPlatform();
  const openExternalUrl = useOpenExternalUrl();
  const showsDiagrams = !lightweight && mayHaveDiagram(markdown);
  const diagrams = useDiagramRenderer(showsDiagrams);
  const showsCode = mayHaveCodeFence(markdown);
  const highlighter = useCodeHighlighter(showsCode);
  const [preview, setPreview] = useState<DiagramPreview | null>(null);
  const previewMounted = useDialogPresence(preview?.open ?? false);
  const closePreview = (): void => {
    setPreview((current) => current && { ...current, open: false });
  };

  const hasImages = IMAGE.test(markdown);
  const hasTaskItems = TASK_ITEM.test(markdown);
  const imageMode = images === "label" ? "label" : "host";
  const hostImages = useMemo<HostImageOptions | null>(
    () =>
      images === "label"
        ? null
        : {
            taskAssets: taskAssetContext
              ? { context: taskAssetContext, resolveTaskAssetSource }
              : null,
            source: images ?? null,
          },
    [images, resolveTaskAssetSource, taskAssetContext],
  );
  // Local links open in the app. Their hook is on only when the text has a link.
  const localLinks = links !== "text" && LINK.test(markdown) ? (links?.local ?? null) : null;
  const usesUrlHook = localLinks !== null || hasImages;
  // A label shows any image, also one whose source the browser cannot load.
  const urlTransform = useMemo(
    () =>
      createMarkdownUrlTransform(
        hostImages ? (src) => isHostImage(src, hostImages) : () => true,
        localLinks,
      ),
    [hostImages, localLinks],
  );
  const hooks = useMemo(
    () =>
      createMarkdownHooks({
        links: links === "text" ? "text" : localLinks,
        images: hasImages ? imageMode : null,
        taskItems: hasTaskItems,
      }),
    [hasImages, hasTaskItems, imageMode, links, localLinks],
  );
  const islands = useMemo<ReactiveIslands | undefined>(
    () =>
      hostImages && hasImages
        ? {
            [HOST_IMAGE_ISLAND]: {
              inline: true,
              render: (data) => {
                const image = parseHostImageData(data);
                return image ? (
                  <MarkdownHostImage
                    src={image.src}
                    alt={image.alt}
                    title={image.title}
                    options={hostImages}
                  />
                ) : null;
              },
            },
          }
        : undefined,
    [hasImages, hostImages],
  );
  const plugins = useMemo(() => {
    const config: PluginConfig = {};
    if (showsCode && highlighter.status === "ready") config.code = highlighter.value;
    if (showsDiagrams) config.renderers = [createDiagramRenderer(diagrams)];
    return config.code || config.renderers ? config : undefined;
  }, [diagrams, highlighter, showsCode, showsDiagrams]);

  const openLink = (anchor: HTMLAnchorElement, event: LinkEvent): void => {
    const destination = anchor.getAttribute(LOCAL_LINK_ATTRIBUTE);
    if (destination !== null) {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (localLinks && !modified) localLinks.open(destination, anchor);
      return;
    }
    // Words keeps the text of a link whose destination is unsafe, without a destination.
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      scrollToFragment(href);
      return;
    }
    if (links !== "text" && links?.open) {
      links.open(href);
      return;
    }
    const { x, y, width, height } = anchor.getBoundingClientRect();
    void openClickedLink(href, event, { x, y, width, height }, openExternalUrl).catch(
      showOpenFailure,
    );
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = closestLink(event);
    const diagram =
      !anchor && event.target instanceof Element
        ? event.target.closest(`[${DIAGRAM_ATTRIBUTE}]`)
        : null;
    if (diagram && event.currentTarget.contains(diagram)) {
      const svg = diagram.querySelector("svg.pele");
      if (svg) setPreview({ svg: svg.outerHTML, open: true });
      return;
    }
    if (!anchor) return;
    event.preventDefault();
    if (event.button === 0) openLink(anchor, event);
  };

  // Enter opens the link once, also when the key repeats.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter") return;
    const anchor = closestLink(event);
    if (!anchor) return;
    event.preventDefault();
    if (!event.repeat) openLink(anchor, event);
  };

  // A middle click opens a web link in the system browser. Other buttons do nothing.
  const handleAuxClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = closestLink(event);
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (event.button !== 1 || !href || href.startsWith("#")) return;
    if (links !== "text" && links?.open) links.open(href);
    else void openExternalUrl(href).catch(showOpenFailure);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (closestLink(event)) event.preventDefault();
  };

  return (
    <>
      <Markdown
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        math={!lightweight}
        controls={false}
        lineNumbers={false}
        components={hooks}
        {...(islands ? { islands } : {})}
        {...(plugins ? { plugins } : {})}
        {...(usesUrlHook ? { urlTransform } : {})}
        className={cn(MARKDOWN_CLASSES[variant], className)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
      >
        {markdown}
      </Markdown>
      {showsDiagrams ? <ClosesOnViewHide onHide={closePreview} /> : null}
      {previewMounted && preview ? (
        <DiagramPreviewDialog preview={preview} onClose={closePreview} />
      ) : null}
    </>
  );
});
