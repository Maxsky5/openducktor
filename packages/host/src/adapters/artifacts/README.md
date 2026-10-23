# Artifact image previews

The worker validates PNG, JPEG, WebP, and GIF images with Sharp. It passes through images within the size and dimension limits. It converts larger images to WebP and keeps animation frames. The worker uses resvg WASM for SVG. The pinned WASM imports only memory, array, string, and error operations. It cannot read files, request network resources, or run SVG scripts.

The worker accepts at most 10 MiB, returns at most 2 MiB, and runs at most two jobs at once. Raster input has a 16 megapixel limit across all frames and a 200-frame limit. Conversion uses a maximum dimension of 1024 pixels. Each job has a ten-second deadline. Each job owns and terminates its worker.

SVG preflight parses XML before resvg receives it. It rejects document type declarations, more than 50,000 elements, more than eight nested SVG data images, and more than 10 MiB of aggregate decoded content. It checks embedded raster metadata and limits aggregate pixels across embedded images and frames to 16 megapixels. XML parsing resolves escaped attributes before these checks. The preview uses the validated bytes with a canonical data URL encoding.

`artifact-preview-font.json` contains the trusted Space Grotesk Latin font and its OFL license. Its source is the existing `apps/electron/public/fonts/space-grotesk-latin-600.woff2` file. The font was converted to TTF with fontTools, then encoded as base64 so both host bundles include it. The WASM renderer cannot use the original WOFF2 file. The bundled font lets SVG text render without access to system fonts or artifact-selected paths.

To regenerate the font, load the source with `fontTools.ttLib.TTFont`, set `font.flavor = None`, save the TTF, and base64-encode the saved bytes into `dataBase64`. Keep the `family` value as `Space Grotesk`.
