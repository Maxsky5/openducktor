import { createDomRenderer, type HtmlIsland, type HtmlOptions } from "@pierre/words/html";
import type { ReactiveIslands } from "@pierre/words/react";
import { type HTMLAttributes, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createInlineFileLinkRenderer } from "./markdown-inline-file-links";

type DomRenderer = ReturnType<typeof createDomRenderer>;
type Islands = ReturnType<DomRenderer["getIslands"]>;
const NO_ISLANDS: Islands = [];

function IslandPortal({
  island,
  definition,
}: {
  island: Islands[number];
  definition: ReactiveIslands[string];
}) {
  const element = definition.render(island.data);
  const mounted = element !== null;
  const { fallback } = island;
  useLayoutEffect(() => {
    fallback.toggleAttribute("hidden", mounted);
    return () => fallback.removeAttribute("hidden");
  }, [fallback, mounted]);
  // oxlint-disable-next-line architecture/require-page-occluder -- The portal is inline in the Markdown, not an overlay.
  return createPortal(element, island.content);
}

type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: string;
  streaming: boolean;
  options: HtmlOptions;
  islands?: ReactiveIslands | undefined;
};

/** The transcript needs a custom HTML formatter. Words' React component cannot take one. */
export function MarkdownWithInlineFileLinks({
  children,
  streaming,
  islands,
  options: htmlOptions,
  ...props
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const renderer = useRef<DomRenderer | undefined>(undefined);
  const [mountedIslands, setMountedIslands] = useState(NO_ISLANDS);
  const htmlIslands = useMemo(
    () =>
      islands &&
      Object.fromEntries(
        Object.entries(islands).map(([name, { render, ...definition }]): [string, HtmlIsland] => [
          name,
          { ...definition, accepts: (data) => render(data) !== null },
        ]),
      ),
    [islands],
  );
  const options = useMemo(() => {
    const next: HtmlOptions = { ...htmlOptions, idPrefix: `${id}-` };
    if (htmlIslands) next.islands = htmlIslands;
    return next;
  }, [htmlOptions, htmlIslands, id]);
  const [initial] = useState(() => {
    const formatter = createInlineFileLinkRenderer(options);
    try {
      const markup = { __html: formatter.render(children, streaming, streaming).html };
      return { formatter, options, markup };
    } finally {
      formatter.dispose();
    }
  });
  useLayoutEffect(() => {
    if (!root.current) return;
    const dom = (renderer.current ??= createDomRenderer(
      root.current,
      initial.options,
      initial.formatter,
    ));
    dom.connect();
    return () => dom.disconnect();
  }, [initial]);
  useLayoutEffect(() => {
    const dom = renderer.current;
    if (!dom) return;
    dom.configure(options);
    dom.update(children, streaming, streaming);
    if (islands || mountedIslands.length) {
      const next = dom.getIslands();
      if (next !== mountedIslands && (next.length || mountedIslands.length)) {
        setMountedIslands(next);
      }
    }
  }, [children, islands, mountedIslands, options, streaming]);

  return (
    <>
      <div
        {...props}
        ref={root}
        data-markdown="root"
        data-streaming={streaming || undefined}
        // oxlint-disable-next-line react/no-danger -- Words filters Markdown and unsafe URLs before it emits HTML.
        dangerouslySetInnerHTML={initial.markup}
      />
      {mountedIslands.map((island) => {
        const definition = islands?.[island.name];
        return (
          definition && <IslandPortal key={island.key} island={island} definition={definition} />
        );
      })}
    </>
  );
}
