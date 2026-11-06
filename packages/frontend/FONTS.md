# Application fonts

## Source and ownership

`src/fonts` owns the font bytes and `faces.css` owns their face definitions. The startup splash Vite plugin embeds those definitions before bootstrap, serves the files in development, and emits the same files into both shell builds. The plugin uses the resolved Vite base for face URLs and the preload. Electron uses `./fonts/` beside its `file:` document. The web shell uses `/fonts/` so direct routes such as `/sessions/` and `/kanban/` load fonts from the application root. Do not add a second face declaration in application CSS or shell HTML.

The files are unchanged WOFF2 assets from `@fontsource-variable/space-grotesk@5.3.0` and `@fontsource/ibm-plex-mono@5.3.0`. The source packages are available at [Fontsource Space Grotesk](https://fontsource.org/fonts/space-grotesk) and [Fontsource IBM Plex Mono](https://fontsource.org/fonts/ibm-plex-mono). Their copied SIL Open Font License notices are `space-grotesk-OFL.txt` and `ibm-plex-mono-OFL.txt`. Both notices ship beside the fonts. No font package is needed at runtime or build time.

## Selection and bytes

| Family | Weights exposed | Subsets | WOFF2 bytes per shell |
| --- | --- | --- | ---: |
| Space Grotesk variable | 400 through 700 | Latin, Latin-ext, Vietnamese | 47,940 |
| IBM Plex Mono static | 400 and 500 | Latin, Latin-ext, Vietnamese, Cyrillic, Cyrillic-ext | 98,984 |
| Total | | Thirteen files | 146,924 |

The Space Grotesk static files for 400, 500, 600, and 700 from `@fontsource/space-grotesk@5.3.0` total 118,768 bytes across the same three subsets. The variable files save 70,828 bytes. Their original axis includes 300, but the CSS exposes only 400 through 700. The Latin variable file is 22,288 bytes. It replaces the old 13,276-byte Latin 600 splash file so the splash and application reuse one payload. Keeping the old file would add a second Latin payload and overlapping faces.

IBM Plex Mono applies to `code, pre` and the Markdown syntax block. Inline code, plain Markdown code blocks, and highlighted code request 500 through `prose-code:font-medium` in both renderer variants. Both weights ship for every subset, as they did in the former Google stylesheet. Tailwind `font-mono` keeps its default stack because the theme still has no `--font-mono`. The family names, fallback stacks, and terminal font policy do not change.

The first local-font implementation omitted 500. Electron then selected the 400 face for a 500 request, so code lost its medium weight. A successful font request alone does not detect this error. Check the weight of the selected face as well as its load status.

## Loading policy

Space Grotesk uses `font-display: block` for the shared faces and an early Latin preload. This retains the splash policy without a second 600 face. IBM Plex Mono uses `swap`, as before. Unicode ranges come from the source packages. The browser loads subsets only when text needs them. The splash minimum display time and dismissal logic do not change.

## Validation

The weight regression test builds both shell bases, checks that IBM Plex Mono exposes 400 and 500, and resolves each declared font URL to its emitted WOFF2 asset. A native macOS Electron probe selected 400 for a 500 request before the repair and 500 after the repair. The repair restores the missing faces without changing text sizes.

### Initial font migration

The initial migration checks loaded all eight declared faces in Chromium and Electron, with external requests blocked. They verified emitted bytes, notices, and URL resolution from `/sessions/`, `/kanban/`, and an Electron `file:` document. They did not check that a 500 request selected a medium face. Those checks could pass while inline code used regular weight.

Light and dark specimens covered body text, headings at all four Space Grotesk weights, `pre` and `code`, Latin-ext text `Łódź Œuvre`, Vietnamese `Tiếng Việt`, Cyrillic `Привет мир`, and Cyrillic-ext `Ѣ Ѫ`. Space Grotesk has no Cyrillic subset, so its existing fallback stack supplies Cyrillic text. IBM Plex Mono supplies the code samples. The Markdown syntax block keeps the same IBM Plex Mono stack. No typography component or theme token changed.

### Layout shift

Three cold Chromium runs per case used the same live web shell, backend, 1440 by 1000 viewport, empty browser contexts, external requests blocked, and a five-second observation after navigation. The baseline restored the original Google links, splash face, and splash bytes into the served HTML; the application bundle and backend stayed the same. This isolates the font change under offline conditions without changing task data.

| Case | CLS in each of three runs |
| --- | --- |
| Before | 0.0034588823 |
| After | 0.0034795099 |

The difference is 0.0000206276. These are offline development startup measurements, not a claim about online startup speed or a packaged application performance benchmark. The baseline uses fallback application fonts when Google is unavailable; the changed shell uses its local fonts.
