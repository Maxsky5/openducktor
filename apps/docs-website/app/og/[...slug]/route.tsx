import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_ORIGIN } from "@/config/site";
import { BRAND_MARK_SVG } from "@/lib/brand-mark";
import { pageImage, source } from "@/lib/source";

// The build writes one image for each page, such as `out/og/mobile/image.png`.
export const revalidate = false;

const fonts = join(process.cwd(), "node_modules/@expo-google-fonts/space-grotesk");

/** The two weights of Space Grotesk, read once for all images. */
const FONTS = Promise.all([
  readFile(join(fonts, "400Regular/SpaceGrotesk_400Regular.ttf")),
  readFile(join(fonts, "600SemiBold/SpaceGrotesk_600SemiBold.ttf")),
]);

const BRAND_MARK = `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString("base64")}`;

/**
 * The link preview image of a page, in the light colors of the OpenDucktor website and its sharing
 * image: the brand on the top, the page title and description, and the site address at the bottom.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();
  const [regular, semiBold] = await FONTS;
  const title = page.url === "/" ? SITE_NAME : page.data.title;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "50px 74px 48px 70px",
        background: "#fbfcfe",
        color: "#182235",
        fontFamily: "Space Grotesk",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* oxlint-disable-next-line nextjs/no-img-element -- the image renderer draws only img elements */}
        <img src={BRAND_MARK} alt="" width={60} height={60} />
        <div style={{ display: "flex", gap: 10, fontSize: 34, fontWeight: 600 }}>
          <span>OpenDucktor</span>
          <span style={{ color: "#526078" }}>Docs</span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          gap: 24,
        }}
      >
        <div style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.4, color: "#526078" }}>
          {page.data.description}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          borderTop: "1px solid #dce2ec",
          paddingTop: 24,
          fontSize: 22,
          color: "#526078",
        }}
      >
        {new URL(SITE_ORIGIN).host}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Space Grotesk", data: regular, weight: 400, style: "normal" },
        { name: "Space Grotesk", data: semiBold, weight: 600, style: "normal" },
      ],
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: pageImage(page).segments }));
}
