# macOS installer artwork

## Design

The installer follows the workflow concept supplied by the user. A violet line connects four small nodes between the native app icon and Applications. The nodes contain a plus, a circle, a diamond, and an ellipsis. The line ends in a right-pointing arrow.

Pale rounded paths frame the workflow above and below. Dashed construction guides, square handles, and short outer paths reproduce the reference composition. The background has a faint neutral gradient. Small violet borders and soft shadows separate the nodes from the background.

The SVG contains no text, embedded image, or font dependency. Finder supplies the actual OpenDucktor icon, Applications folder, alias badge, file labels, and window title bar. The native title bar follows the user's macOS appearance. The reference's placeholder app icon and simulated window chrome are not part of the background.

## Source and layout

`dmg-background.svg` is the complete source. Electron Builder consumes `dmg-background.png` and `dmg-background@2x.png`, rendered at 700 by 406 and 1400 by 812 pixels. The composition uses the upper 374 points. The remaining 32 points allow for Finder window chrome, because the packager uses the image dimensions for the whole window.

Finder supplies the 104-point icons at `(170, 170)` and `(528, 170)`, as configured in `../electron-builder.yml`. Keep the space below both icons clear for the Applications alias badge and native 13-point file labels. Do not add file icons or labels to the background.

## Render

Run these commands from the repository root with `rsvg-convert` from librsvg:

```sh
rsvg-convert -w 700 -h 406 -o apps/electron/resources/dmg-background.png apps/electron/resources/dmg-background.svg
rsvg-convert -w 1400 -h 812 -o apps/electron/resources/dmg-background@2x.png apps/electron/resources/dmg-background.svg
```

Commit both rendered PNGs after a source change. Check the composition at its actual size in Finder. Check the standard and Retina renders for line clarity and label clearance. Keep the configured icon centers and the SVG layout in sync.
