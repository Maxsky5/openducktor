#!/bin/sh
# Builds the app icon, Android adaptive icon layers, and splash mark from the SVG sources.
# Run from apps/mobile after a change to assets/source. Needs rsvg-convert and ImageMagick.
set -eu
src=assets/source
out=assets/images
# iOS needs an opaque full-bleed square; the system applies the corner mask.
rsvg-convert -w 1024 -h 1024 "$src/icon-full.svg" | magick - -alpha off "$out/icon.png"
rsvg-convert -w 1024 -h 1024 "$src/mark-foreground.svg" -o "$out/adaptive-foreground.png"
rsvg-convert -w 1024 -h 1024 "$src/mark-monochrome.svg" -o "$out/adaptive-monochrome.png"
rsvg-convert -w 512 -h 512 "$src/splash-mark.svg" -o "$out/splash-mark.png"
