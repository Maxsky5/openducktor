/**
 * The Markdown view of the app. `@pierre/words` parses and renders the text into its own DOM, so a
 * long document or a streamed reply renders in a fraction of a millisecond. The view adds what
 * Words leaves to the app: link and diagram clicks, task checkboxes, and images that the host loads.
 */
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { HtmlOptions, PluginConfig } from "@pierre/words/html";
import { Markdown, type MarkdownProps, type ReactiveIslands } from "@pierre/words/react";
import type { MouseEvent, ReactElement } from "react";
import { memo, useId, useLayoutEffect, useMemo, useState } from "react";
import { useOnSessionViewHide } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { useShellPlatform } from "@/lib/shell-platform";
import { cn } from "@/lib/utils";
import { Dialog } from "./dialog";
import { useDialogPresence } from "./dialog-presence";
import { mountFileTypeIconSpriteForLinks } from "./file-type-icons";
import { mayHaveCodeFence, useCodeHighlighter } from "./markdown-code";
import {
  createDiagramRenderer,
  DIAGRAM_ATTRIBUTE,
  mayHaveDiagram,
  useDiagramRenderer,
} from "./markdown-diagram";
import { MarkdownHostImage } from "./markdown-host-image";
import {
  type HostImageOptions,
  isHostImage,
  type MarkdownImageSource,
} from "./markdown-host-image-kind";
import {
  createMarkdownHooks,
  createMarkdownUrlTransform,
  HOST_IMAGE_ISLAND,
  type MarkdownLinks,
  type MarkdownLocalLinks,
  parseHostImageData,
} from "./markdown-html";
import { IslandLink } from "./markdown-island-link";
import { MarkdownWithInlineFileLinks } from "./markdown-inline-file-view";
import { closestLink, useMarkdownLinkEvents } from "./markdown-link-events";
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
 * Words formats a streamed reply in place only without element hooks and plugins, so each hook is
 * on only when the text can use it. These checks are cheap. They can find a hook use that is not
 * there, but they never miss one.
 */
const TASK_ITEM = /\[[ xX]\]/;
/** An inline link, a link reference, or an autolink with a scheme, such as `<file:///a.ts>`. */
const LINK = /\]\(|\]:|<[a-z][\w+.-]*:/i;

/** The open diagram, and the element that had the focus when it opened. */
type DiagramPreview = { svg: string; open: boolean; opener: HTMLElement | null };

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
      <MarkdownMermaidDialog
        svg={preview.svg}
        // Words writes the expand button, so the preview has no dialog trigger that Radix gives the
        // focus back to. The focus goes back to the element that opened the preview.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          preview.opener?.focus();
        }}
      />
    </Dialog>
  );
}

function useFileLinkSpriteRootId(
  markdown: string,
  streaming: boolean,
  hasLinks: boolean,
  localLinks: MarkdownLocalLinks | null,
): string | undefined {
  const markdownId = useId();
  const mayHaveFileLink = hasLinks || (localLinks?.inlineFilePaths && markdown.includes("`"));
  const rootId = mayHaveFileLink && localLinks?.chip ? markdownId : undefined;
  // Words commits the link markup in its layout effect. Check it before the browser paints.
  useLayoutEffect(() => {
    if (rootId) mountFileTypeIconSpriteForLinks(rootId);
  }, [rootId, markdown, streaming]);
  return rootId;
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
  const linkEvents = useMarkdownLinkEvents(links);
  const showsDiagrams = !lightweight && mayHaveDiagram(markdown);
  const diagrams = useDiagramRenderer(showsDiagrams);
  const showsCode = mayHaveCodeFence(markdown);
  const highlighter = useCodeHighlighter(showsCode);
  const codeFailure = showsCode && highlighter.status === "failed" ? highlighter.message : null;
  const [preview, setPreview] = useState<DiagramPreview | null>(null);
  const previewMounted = useDialogPresence(preview?.open ?? false);
  const closePreview = (): void => {
    setPreview((current) => current && { ...current, open: false });
  };

  const hasImages = markdown.includes("![");
  const hasTaskItems = TASK_ITEM.test(markdown);
  const hasLinks = LINK.test(markdown);
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
  const localLinks = links !== "text" ? (links?.local ?? null) : null;
  const fileLinkRootId = useFileLinkSpriteRootId(markdown, streaming, hasLinks, localLinks);
  // The URL rule is always on. Words formats in place also with it, but a change of the rule
  // formats all the text again. A label shows any image, also one whose source the browser
  // cannot load.
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
        links: links === "text" ? "text" : hasLinks ? localLinks : null,
        images: hasImages ? imageMode : null,
        taskItems: hasTaskItems,
        codeFailure,
      }),
    [codeFailure, hasImages, hasLinks, hasTaskItems, imageMode, links, localLinks],
  );
  const islands = useMemo<ReactiveIslands | undefined>(
    () =>
      hostImages && hasImages
        ? {
            [HOST_IMAGE_ISLAND]: {
              render: (data) => {
                const image = parseHostImageData(data);
                return image ? (
                  <IslandLink>
                    <MarkdownHostImage
                      src={image.src}
                      alt={image.alt}
                      title={image.title}
                      options={hostImages}
                    />
                  </IslandLink>
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

  // A click on a diagram opens its preview. Other clicks go to the links.
  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const diagram =
      event.target instanceof Element ? event.target.closest(`[${DIAGRAM_ATTRIBUTE}]`) : null;
    const svg = diagram?.querySelector("svg.pele");
    if (svg && !closestLink(event) && event.currentTarget.contains(svg)) {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPreview({ svg: svg.outerHTML, open: true, opener });
      return;
    }
    linkEvents.onClick(event);
  };

  const options = useMemo(() => {
    const next: Omit<HtmlOptions, "islands"> = {
      math: !lightweight,
      controls: false,
      lineNumbers: false,
      components: hooks,
      urlTransform,
    };
    if (plugins) next.plugins = plugins;
    return next;
  }, [hooks, lightweight, plugins, urlTransform]);
  const contentProps: Pick<MarkdownProps, "id" | "islands" | "className"> & typeof linkEvents = {
    id: fileLinkRootId,
    className: cn(MARKDOWN_CLASSES[variant], className),
    ...linkEvents,
    onClick: handleClick,
  };
  if (islands) contentProps.islands = islands;

  return (
    <>
      {localLinks?.inlineFilePaths ? (
        <MarkdownWithInlineFileLinks
          {...contentProps}
          options={options}
          chip={localLinks.chip}
          streaming={streaming}
        >
          {markdown}
        </MarkdownWithInlineFileLinks>
      ) : (
        <Markdown
          {...contentProps}
          {...options}
          mode={streaming ? "streaming" : "static"}
          isAnimating={streaming}
        >
          {markdown}
        </Markdown>
      )}
      {showsDiagrams ? <ClosesOnViewHide onHide={closePreview} /> : null}
      {previewMounted && preview ? (
        <DiagramPreviewDialog preview={preview} onClose={closePreview} />
      ) : null}
    </>
  );
});
