import { BRAND_MARK_SVG } from "@/lib/brand-mark";

export function NavTitle() {
  return (
    <>
      <span
        className="docs-brand-mark"
        aria-hidden="true"
        // oxlint-disable-next-line react/no-danger -- the mark file of this repository, with no input
        dangerouslySetInnerHTML={{ __html: BRAND_MARK_SVG }}
      />
      <span className="docs-brand-name">
        OpenDucktor <span className="docs-brand-suffix">Docs</span>
      </span>
    </>
  );
}
