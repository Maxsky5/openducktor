"use client";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import Image, { type StaticImageData } from "next/image";
import { useAppearance } from "./appearance";

type CaptureProps = { src: StaticImageData; alt: string; sizes: string; className: string };

/**
 * One capture of a screen. The capture of the page appearance opens at full size on a click. The
 * hidden capture stays a plain image, so it costs no zoom state, observers, or listeners. The
 * server and the first render know no appearance, so both start plain.
 */
function Capture({ zoom, ...image }: CaptureProps & { zoom: boolean }) {
  if (!zoom) return <Image {...image} />;
  return <ImageZoom {...image} />;
}

/** The light and the dark capture of a screen. The page shows the capture of its appearance. */
export function ScreenPair({
  light,
  dark,
  alt,
  sizes,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
}) {
  const { appearance } = useAppearance();
  return (
    <>
      <Capture
        zoom={appearance === "light"}
        src={light}
        alt={alt}
        sizes={sizes}
        className="docs-shot-light"
      />
      <Capture
        zoom={appearance === "dark"}
        src={dark}
        alt={alt}
        sizes={sizes}
        className="docs-shot-dark"
      />
    </>
  );
}
