import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/intent-link";

export const metadata: Metadata = {
  title: "Page not found",
  // Next.js gives the not-found page its own `noindex` tag, so the page drops the tag of the layout.
  robots: null,
};

export default function NotFound() {
  return (
    <DocsPage footer={{ enabled: false }} tableOfContent={{ enabled: false }}>
      <DocsTitle id="docs-title" tabIndex={-1}>
        Page not found
      </DocsTitle>
      <DocsBody>
        <p>
          This address has no documentation page. The page can have a new name, or the link can be
          incorrect.
        </p>
        <ul>
          <li>
            <Link href="/">Read the overview</Link>
          </li>
          <li>
            <Link href="/install-and-update/">Install OpenDucktor</Link>
          </li>
          <li>
            <Link href="/troubleshooting/">Solve a problem</Link>
          </li>
        </ul>
        <p>You can also search the documentation, or select a page in the navigation.</p>
      </DocsBody>
    </DocsPage>
  );
}
