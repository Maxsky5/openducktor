# OpenDucktor scroll

This local Android Expo module makes a scroll view redraw in the frame of each scroll.
Expo autolinking finds the module in `apps/mobile/modules`.

## Why

Fabric mounts view changes in a frame callback.
`View.scrollTo` asks for the redraw of the scroll view on the next frame, but a layout change of the same mount draws in the current frame.
A list that keeps a row in place after a layout change, such as a `maintainVisibleContentPosition` correction, scrolls in the same mount as the new row positions.
Without this module, the rows show one frame at the wrong place.

## API

`index.ts` exports `redrawOnScroll(viewTag)`.
Call it with the view tag of a native scroll view.
A second call for the same view changes nothing, so a list can call it on each layout.
Fabric reports the layout of a view before it mounts the view, so a view that is not mounted yet gets the redraw after the next mount.

## Platforms

The module is for Android only.
iOS draws a scroll and the layout changes of the same mount in the same frame.
