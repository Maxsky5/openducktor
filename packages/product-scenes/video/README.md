# Scene videos

This folder renders a product scene to an MP4 file for social media. It is a development tool: no app and no package export uses it.

## Requirements

- Install `ffmpeg` and put it on the `PATH`. On macOS, run `brew install ffmpeg`. Without it, the command stops with an error.
- Install Chromium for Playwright once: run `bunx playwright-core install chromium` in `packages/product-scenes`.

## Render a video

Run the command in `packages/product-scenes`:

```sh
bun run render:video -- --scene hero --format 16:9 --theme dark --fps 60
```

| Option | Values | Default |
|---|---|---|
| `--scene` | A loop scene: `hero`, `palette`, `runtimes`, `autopilot`, `chat`, `mcp`, `prompts`, `actions`, `local` | Necessary |
| `--format` | `16:9` (1920 × 1080), `1:1` (1080 × 1080), `9:16` (1080 × 1920) | `16:9` |
| `--theme` | `light`, `dark` | `light` |
| `--keys` | `mac` (⌘ and ⌥), `pc` (Ctrl and Alt) | `mac` |
| `--fps` | A whole number from 1 to 120 | `60` |
| `--seconds` | The length of the video, up to the length of one run of the scene | One run |
| `--out` | The path of the MP4 file | `video/out/<scene>-<format>-<theme>.mp4` |
| `--frames` | A folder for a copy of each frame as a PNG file | No copy |

The output is H.264 in `yuv420p` with CRF 18 and BT.709 colors.

The `workflow` scene is a chapter player. Its player has no handle that seeks a time, so the command does not accept it.

## How it works

1. `render.ts` starts a Vite server for `index.html` on a free port and opens the page in headless Chromium at the size of the video.
2. `main.ts` renders the static view of the scene, as the website does, and mounts its timeline with `mountScene`. The scene keeps its design width from `src/registry.ts`, and a transform scales it to fit the video on the page color of the website.
3. The page waits for its fonts and then gives the renderer `window.__sceneVideo` with `ready` and `seek`.
4. For each frame, the renderer calls `seek(index / fps)`, takes a screenshot, and sends the PNG data to `ffmpeg`.

## Same frames in each run

- The scene does not play by itself: `mountScene` has no play zone and no pause control, and the renderer never calls `play`.
- `seek` moves the GSAP timeline in steps of 1/60 s, as the scene plays on the page.
- The CSS animations and transitions, such as the status rings and the caret, stay paused. Each one gets its time from the frame clock.
- The page uses the Latin font files of the package and waits until they load.

To check it, render the same command twice with `--frames` and compare the hashes of the PNG files.
