# Scene videos

This folder renders a product scene or a film to an MP4 file for social media. It is a development tool: no app and no package export uses it.

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
| `--scene` | A loop scene of `src/registry.ts`, such as `hero` or `goal-mode` | `--scene` or `--film` |
| `--film` | A film of `src/films/registry.ts`, such as `release-1-2-2`. A film has its own frame size, so the command does not accept `--format` | `--scene` or `--film` |
| `--format` | `16:9` (1920 × 1080), `1:1` (1080 × 1080), `9:16` (1080 × 1920) | `16:9` |
| `--stage` | For a scene: the stage width in CSS pixels, such as `390` for the phone layout | The design width of the scene |
| `--theme` | `light`, `dark` | `light` |
| `--keys` | `mac` (⌘ and ⌥), `pc` (Ctrl and Alt) | `mac` |
| `--fps` | A whole number from 1 to 120 | `60` |
| `--scale` | `1`, or `2` for 2 video pixels for each CSS pixel. `2` renders a film of 1920 × 1080 in 4K, so small text stays sharp on a high density screen | `1` |
| `--blur` | For a film: the screenshots that each frame mixes while the camera moves, from 1 to 16. The command takes them in the first half of the frame time, as a camera shutter of 180 degrees, so a fast move shows motion blur. A frame where the camera does not move keeps one screenshot and stays sharp | `1` (no motion blur) |
| `--from` | The time of the first frame, in seconds. The page plays the frames before it with no image | `0` |
| `--seconds` | The length of the video, up to the end of the run | Up to the end |
| `--snap` | Times in seconds, such as `5,12.5`. The command saves one PNG image for each time in the `--out` folder, and no video. It does not accept the options of a video: `--fps`, `--blur`, `--from`, `--seconds`, and `--frames` | No image |
| `--out` | The path of the MP4 file | `video/out/<scene>-<format>-<theme>.mp4` |
| `--frames` | A folder for a copy of each frame as a PNG file | No copy |

The output is H.264 in `yuv420p` with CRF 18 and BT.709 colors.

The `workflow` scene is a chapter player. Its player has no handle that seeks a time, so the command does not accept it.

## Render a film

```sh
bun run render:video -- --film release-1-2-2 --theme dark --scale 2 --blur 4 --out ~/Movies/openducktor-1.2.2-dark.mp4
bun run render:video -- --film release-1-2-2 --theme light --scale 2 --blur 4 --out ~/Movies/openducktor-1.2.2-light.mp4
bun run render:video -- --film release-1-2-2 --snap 6,20,45 --out /tmp/film-stills
```

To watch a scene or a film in a browser, run `bun run preview:video`, then open `http://127.0.0.1:4410/?film=release-1-2-2&theme=dark&preview&play`. For a scene, use `?scene=hero&width=1920&height=1080&preview&play`. Space plays and pauses, the right arrow jumps 1 s forward (5 s with Shift), and the left arrow loads the page again 1 s earlier. Add `t=30` to start at 30 s.

## How it works

1. `render.ts` starts a Vite server for `index.html` on a free port and opens the page in headless Chromium at the size of the video.
2. `main.ts` renders the static view of the scene, as the website does, and mounts its timeline with `mountScene`. The scene keeps its design width from `src/registry.ts`, and a transform scales it to fit the video on the page color of the website.
3. The page waits for its fonts and then gives the renderer `window.__sceneVideo` with `ready`, `seek`, and `moving`.
4. For each frame, the renderer calls `seek(index / fps)`, takes a screenshot, and sends the PNG data to `ffmpeg`. With `--blur N`, it takes N screenshots in the first half of the time of each frame where the camera of the film moves, and `ffmpeg` mixes each group into one frame. `moving` tells the renderer whether a move of the camera runs in that half of the frame.

The server neither watches the sources nor sends updates, so a change of a source does not reload the page of a job that runs. Run one job at a time: two jobs share the Vite cache of the dependencies.

A film page renders the view of the film at its frame size and mounts it with `mountFilm`, which loads the builder of the scene of each set and builds the master timeline. Its `seek` plays forward in steps of 1/60 s, so each change of a scene runs at its time.

## Same frames in each run

- The scene does not play by itself: `mountScene` has no play zone and no pause control, and the renderer never calls `play`.
- `seek` moves the GSAP timeline in steps of 1/60 s, as the scene plays on the page.
- The CSS animations and transitions, such as the status rings and the caret, stay paused. Each one gets its time from the frame clock.
- The page uses the Latin font files of the package and waits until they load.

To check it, render the same command twice with `--frames` and compare the hashes of the PNG files.
