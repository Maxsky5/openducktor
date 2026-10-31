# OpenDucktor scroll

This local Android Expo module makes a scroll view redraw in the frame of each scroll.
Expo autolinking finds the module in `apps/mobile/modules`.

## Why

`View.scrollTo` asks for the redraw of the scroll view on the next frame.
A layout change in the same mount draws in the current frame.
A list that keeps a row in place after the row changes size scrolls in the same mount as the new row positions.
Without this module, the rows show one frame at the wrong place.

## API

`index.ts` exports `redrawOnScroll(viewTag)`.
Call it once with the view tag of the native scroll view.
It resolves to `false` when the view is gone.

## Platforms

The module is for Android only.
iOS draws a scroll and the layout changes of the same mount in the same frame.
