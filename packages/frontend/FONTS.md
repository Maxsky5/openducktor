# Application fonts

## Source and ownership

`src/fonts` owns the font bytes and `faces.css` owns their face definitions. The startup splash Vite plugin embeds those definitions before bootstrap, serves the files in development, and emits the same files into both shell builds. Relative `./fonts/` URLs work with Electron `file:` documents and HTTP documents. Do not add a second face declaration in application CSS or shell HTML.

The files are unchanged WOFF2 assets from `@fontsource-variable/space-grotesk@5.3.0` and `@fontsource/ibm-plex-mono@5.3.0`. The source packages are available at [Fontsource Space Grotesk](https://fontsource.org/fonts/space-grotesk) and [Fontsource IBM Plex Mono](https://fontsource.org/fonts/ibm-plex-mono). Their copied SIL Open Font License notices are `space-grotesk-OFL.txt` and `ibm-plex-mono-OFL.txt`. Both notices ship beside the fonts. No font package is needed at runtime or build time.

## Selection and bytes

| Family | Weights exposed | Subsets | WOFF2 bytes per shell |
| --- | --- | --- | ---: |
| Space Grotesk variable | 400 through 700 | Latin, Latin-ext, Vietnamese | 47,940 |
| IBM Plex Mono static | 400 | Latin, Latin-ext, Vietnamese, Cyrillic, Cyrillic-ext | 49,192 |
| Total | | Eight files | 97,132 |

The Space Grotesk static files for 400, 500, 600, and 700 from `@fontsource/space-grotesk@5.3.0` total 118,768 bytes across the same three subsets. The variable files save 70,828 bytes. Their original axis includes 300, but the CSS exposes only 400 through 700. The Latin variable file is 22,288 bytes. It replaces the old 13,276-byte Latin 600 splash file so the splash and application reuse one payload. Keeping the old file would add a second Latin payload and overlapping faces.

IBM Plex Mono applies to `code, pre` and the Markdown syntax block. Neither owner requests 500, so only 400 ships. Tailwind `font-mono` keeps its default stack because the theme still has no `--font-mono`. The family names, fallback stacks, and terminal font policy do not change.

## Loading policy

Space Grotesk uses `font-display: block` for the shared faces and an early Latin preload. This retains the splash policy without a second 600 face. IBM Plex Mono uses `swap`, as before. Unicode ranges come from the source packages. The browser loads subsets only when text needs them. The splash minimum display time and dismissal logic do not change.

## Validation

Both development Vite configurations served all eight WOFF2 files. The web shell loaded the Latin face once during startup. Fresh Chromium contexts loaded all required weights and language subsets with external requests blocked. The standalone HTTP build requested each of the eight payloads once. A real Electron BrowserWindow loaded all eight faces from the renderer build through `file:` URLs. The shell builds contain identical font bytes and both notices.

Light and dark specimens covered body text, headings at all four Space Grotesk weights, `pre` and `code`, Latin-ext text `Łódź Œuvre`, Vietnamese `Tiếng Việt`, Cyrillic `Привет мир`, and Cyrillic-ext `Ѣ Ѫ`. Space Grotesk has no Cyrillic subset, so its existing fallback stack supplies Cyrillic text. IBM Plex Mono supplies the code samples. The Markdown syntax block keeps the same IBM Plex Mono stack. No typography component or theme token changed.

### Layout shift

Three cold Chromium runs per case used the same live web shell, backend, 1440 by 1000 viewport, empty browser contexts, external requests blocked, and a five-second observation after navigation. The baseline restored the original Google links, splash face, and splash bytes into the served HTML; the application bundle and backend stayed the same. This isolates the font change under offline conditions without changing task data.

| Case | CLS in each of three runs |
| --- | --- |
| Before | 0.0034588823 |
| After | 0.0034795099 |

The difference is 0.0000206276. These are offline development startup measurements, not a claim about online startup speed or a packaged application performance benchmark. The baseline uses fallback application fonts when Google is unavailable; the changed shell uses its local fonts.
