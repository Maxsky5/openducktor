import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT } from "@/components/appearance";
import { InputModality } from "@/components/input-modality";
import { Provider } from "@/components/provider";
import { RouteFocus } from "@/components/route-focus";
import { SEARCH_TAP_SCRIPT } from "@/components/search-tap";
import { OPEN_GRAPH, readBuildTarget, SITE_NAME, SITE_ORIGIN } from "@/config/site";
import { baseOptions } from "@/lib/layout";
import { source } from "@/lib/source";
import "./global.css";

// The fonts and the family names that the product scenes need: Space Grotesk, and IBM Plex Mono at
// 400 and 500. The text of the docs and of the scenes uses only Latin characters. The page
// preloads the files of the text and the code, and a fallback with the same metrics shows until a
// file loads. Only the scenes use IBM Plex Mono 500, so it loads when a scene shows. Each variable
// holds the fallback, and `app/global.css` puts the family name before it.
const spaceGrotesk = localFont({
  src: "../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  declarations: [{ prop: "font-family", value: "Space Grotesk Variable" }],
  variable: "--font-docs-sans",
});
const ibmPlexMono = localFont({
  src: "../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  weight: "400",
  declarations: [{ prop: "font-family", value: "IBM Plex Mono" }],
  variable: "--font-docs-mono",
});
// The scenes read this weight through the family name. The variable only names it on the root.
const ibmPlexMonoMedium = localFont({
  src: "../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  weight: "500",
  declarations: [{ prop: "font-family", value: "IBM Plex Mono" }],
  variable: "--font-docs-mono-medium",
  preload: false,
});

const indexable = readBuildTarget() === "production";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { template: `%s | ${SITE_NAME}`, default: SITE_NAME },
  description:
    "Learn to install OpenDucktor and run coding agents from the specification to the pull request.",
  applicationName: SITE_NAME,
  robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
  openGraph: OPEN_GRAPH,
  // Next.js takes the title, the description, and the image of the card from `openGraph`.
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfe" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1421" },
  ],
};

/** Hides the controls that need scripts, such as search and appearance, when scripts do not run. */
const NO_SCRIPT_STYLE =
  "[data-search],[data-search-full],[data-requires-script]{display:none!important}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} ${ibmPlexMonoMedium.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * A fixed inline script sets the system appearance while the browser reads the head, before
         * the first paint, and keeps a search tap from before hydration. A Next.js `Script` runs
         * only after the framework scripts load.
         */}
        <script
          // oxlint-disable-next-line react/no-danger -- a fixed script of this repository, with no input
          dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }}
        />
        <script
          // oxlint-disable-next-line react/no-danger -- a fixed script of this repository, with no input
          dangerouslySetInnerHTML={{ __html: SEARCH_TAP_SCRIPT }}
        />
        <noscript>
          <style>{NO_SCRIPT_STYLE}</style>
        </noscript>
      </head>
      <body>
        {/* react-doctor-disable-next-line react-doctor/anchor-target-exists -- page.tsx and not-found.tsx render #docs-title. */}
        <a className="docs-skip-link" href="#docs-title">
          Skip to content
        </a>
        <Provider>
          <RouteFocus />
          <InputModality />
          <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  );
}
