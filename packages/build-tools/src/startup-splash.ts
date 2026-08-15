export const OPEN_DUCKTOR_STARTUP_BACKGROUND = "#ffffff";

const STARTUP_SPLASH_STYLES = `
:root {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_BACKGROUND};
  --odt-startup-foreground: #5100ff;
  --odt-startup-muted: rgba(81, 0, 255, 0.68);
  --odt-startup-line: rgba(81, 0, 255, 0.18);
  --odt-startup-surface: rgba(81, 0, 255, 0.06);
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  background: var(--odt-startup-background);
}

.odt-startup {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--odt-startup-background);
  color: var(--odt-startup-foreground);
  font-family: "Space Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  opacity: 1;
  transition: opacity 160ms ease-out;
}

.odt-startup::before,
.odt-startup::after {
  position: absolute;
  width: min(70vw, 52rem);
  aspect-ratio: 1;
  border: 1px solid rgba(81, 0, 255, 0.08);
  border-radius: 50%;
  content: "";
}

.odt-startup::before {
  top: -48%;
  right: -18%;
}

.odt-startup::after {
  bottom: -55%;
  left: -20%;
}

.odt-startup--leaving {
  pointer-events: none;
  opacity: 0;
}

.odt-startup__content {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 1.75rem;
  padding: 2rem;
  text-align: center;
}

.odt-startup__stage {
  position: relative;
  display: grid;
  width: 9rem;
  height: 9rem;
  place-items: center;
}

.odt-startup__orbit {
  position: absolute;
  inset: 0;
  border: 1px solid var(--odt-startup-line);
  border-radius: 50%;
  animation: odt-startup-spin 5s linear infinite;
}

.odt-startup__orbit::before {
  position: absolute;
  top: 50%;
  left: -0.25rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--odt-startup-foreground);
  content: "";
  transform: translateY(-50%);
}

.odt-startup__orbit--inner {
  inset: 1rem;
  border-color: rgba(81, 0, 255, 0.28);
  animation-direction: reverse;
  animation-duration: 3.5s;
}

.odt-startup__orbit--inner::before {
  right: -0.1875rem;
  left: auto;
  width: 0.375rem;
  height: 0.375rem;
  background: rgba(81, 0, 255, 0.7);
}

.odt-startup__mark {
  position: relative;
  display: grid;
  width: 4.5rem;
  height: 4.5rem;
  place-items: center;
  border: 1px solid rgba(81, 0, 255, 0.2);
  border-radius: 1.5rem;
  background: var(--odt-startup-surface);
  box-shadow: 0 1.25rem 3rem rgba(81, 0, 255, 0.12);
}

.odt-startup__mark img {
  display: block;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 1rem;
}

.odt-startup__copy {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
}

.odt-startup__title {
  margin: 0;
  font-size: clamp(1.65rem, 4vw, 2rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
}

.odt-startup__status {
  margin: 0;
  color: var(--odt-startup-muted);
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  line-height: 1.5;
  text-transform: uppercase;
}

.odt-startup__dots {
  display: flex;
  gap: 0.35rem;
  height: 0.4rem;
  align-items: center;
}

.odt-startup__dots span {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: var(--odt-startup-foreground);
  animation: odt-startup-dot 1.2s ease-in-out infinite;
}

.odt-startup__dots span:nth-child(2) {
  animation-delay: 120ms;
}

.odt-startup__dots span:nth-child(3) {
  animation-delay: 240ms;
}

.odt-startup--failed .odt-startup__orbit,
.odt-startup--failed .odt-startup__dots span {
  animation: none;
}

.odt-startup--failed .odt-startup__dots {
  display: none;
}

@keyframes odt-startup-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes odt-startup-dot {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-0.18rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .odt-startup {
    transition: none;
  }

  .odt-startup__orbit,
  .odt-startup__dots span {
    animation: none;
  }
}
`;

const STARTUP_SPLASH_MARKUP = `
<div class="odt-startup__content">
  <div class="odt-startup__stage" aria-hidden="true">
    <div class="odt-startup__orbit"></div>
    <div class="odt-startup__orbit odt-startup__orbit--inner"></div>
    <div class="odt-startup__mark">
      <img src="./favicon.svg" alt="" width="52" height="52" />
    </div>
  </div>
  <div class="odt-startup__copy">
    <p class="odt-startup__title">OpenDucktor</p>
    <p class="odt-startup__status" data-odt-startup-status>Preparing your workspace</p>
    <div class="odt-startup__dots" aria-hidden="true"><span></span><span></span><span></span></div>
  </div>
</div>
`;

type StartupSplashHtmlTag = {
  tag: string;
  attrs?: Record<string, string>;
  children: string;
  injectTo: "head-prepend" | "body-prepend";
};

export const createOpenDucktorStartupSplashPlugin = () => ({
  name: "openducktor-startup-splash",
  enforce: "pre" as const,
  transformIndexHtml: (): { tags: StartupSplashHtmlTag[] } => ({
    tags: [
      {
        tag: "style",
        attrs: { id: "openducktor-startup-styles" },
        children: STARTUP_SPLASH_STYLES,
        injectTo: "head-prepend",
      },
      {
        tag: "div",
        attrs: {
          id: "openducktor-startup",
          class: "odt-startup",
          role: "status",
          "aria-label": "OpenDucktor is starting",
          "aria-live": "polite",
        },
        children: STARTUP_SPLASH_MARKUP,
        injectTo: "body-prepend",
      },
    ],
  }),
});
