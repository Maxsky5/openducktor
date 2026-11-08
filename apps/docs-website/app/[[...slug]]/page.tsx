import { PageFocus } from "@/components/route-focus";
import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/notebook/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/components/mdx";
import { OPEN_GRAPH, SITE_NAME } from "@/config/site";
import { pageImage, source } from "@/lib/source";

type PageProps = { params: Promise<{ slug?: string[] }> };

// Only the pages of the content folder exist. Cloudflare answers other paths with `404.html`.
export const dynamicParams = false;

export default async function Page({ params }: PageProps) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;
  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: "clerk" }}
      // The Overview ends with its own start cards, which replace the next page link.
      footer={{ enabled: page.url !== "/" }}
    >
      <PageFocus path={page.url} />
      <DocsTitle id="docs-title" tabIndex={-1}>
        {page.data.title}
      </DocsTitle>
      <DocsBody>
        <Content components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  // The Overview has the site name as its whole title.
  const overview = page.url === "/";
  return {
    title: overview ? { absolute: SITE_NAME } : page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      ...OPEN_GRAPH,
      title: overview ? SITE_NAME : page.data.title,
      description: page.data.description,
      url: page.url,
      images: pageImage(page).url,
    },
  };
}
