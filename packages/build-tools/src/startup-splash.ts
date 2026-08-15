export const OPEN_DUCKTOR_STARTUP_BACKGROUND = "#ffffff";

const STARTUP_SPLASH_STYLES = `
:root {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_BACKGROUND};
  --odt-startup-foreground: #5100ff;
  --odt-startup-line: rgba(81, 0, 255, 0.16);
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

.odt-startup--leaving {
  pointer-events: none;
  opacity: 0;
}

.odt-startup__content {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 3rem;
  padding: 2rem;
  text-align: center;
}

.odt-startup__stage {
  position: relative;
  display: grid;
  width: 5rem;
  height: 5rem;
  place-items: center;
}

.odt-startup__stage::before {
  position: absolute;
  width: 12.5rem;
  height: 12.5rem;
  border-radius: 50%;
  background: rgba(81, 0, 255, 0.025);
  content: "";
}

.odt-startup__ring,
.odt-startup__orbit {
  position: absolute;
  width: 8rem;
  height: 8rem;
  box-sizing: border-box;
  border-radius: 50%;
}

.odt-startup__ring {
  border: 1px solid var(--odt-startup-line);
}

.odt-startup__ring--outer {
  width: 10rem;
  height: 10rem;
  border-color: rgba(81, 0, 255, 0.08);
}

.odt-startup__orbit {
  animation: odt-startup-spin 8s linear infinite;
}

.odt-startup__orbit::after {
  position: absolute;
  top: -0.25rem;
  left: 50%;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--odt-startup-foreground);
  content: "";
  transform: translateX(-50%);
}

.odt-startup__orbit--second {
  animation-delay: -2.67s;
}

.odt-startup__orbit--second::after {
  top: -0.21875rem;
  width: 0.375rem;
  height: 0.375rem;
  background: rgba(81, 0, 255, 0.72);
}

.odt-startup__orbit--third {
  animation-delay: -5.33s;
}

.odt-startup__orbit--third::after {
  top: -0.1875rem;
  width: 0.3125rem;
  height: 0.3125rem;
  background: rgba(81, 0, 255, 0.48);
}

.odt-startup__mark {
  position: relative;
  display: grid;
  width: 4.5rem;
  height: 4.5rem;
  place-items: center;
  animation: odt-startup-breathe 3s ease-in-out infinite;
  border-radius: 1.125rem;
  box-shadow: 0 1.25rem 3rem rgba(81, 0, 255, 0.16);
}

.odt-startup__mark img {
  display: block;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 1.125rem;
}

.odt-startup__title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
}

.odt-startup__failure {
  display: none;
  max-width: 24rem;
  margin: -1.75rem 0 0;
  color: rgba(81, 0, 255, 0.72);
  font-size: 0.875rem;
  line-height: 1.5;
}

.odt-startup--failed .odt-startup__orbit,
.odt-startup--failed .odt-startup__mark {
  animation: none;
}

.odt-startup--failed .odt-startup__failure {
  display: block;
}

@keyframes odt-startup-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes odt-startup-breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.045);
  }
}

@media (prefers-reduced-motion: reduce) {
  .odt-startup {
    transition: none;
  }

  .odt-startup__orbit,
  .odt-startup__mark {
    animation: none;
  }
}
`;

const STARTUP_SPLASH_MARKUP = `
<div class="odt-startup__content">
  <div class="odt-startup__stage" aria-hidden="true">
    <div class="odt-startup__ring"></div>
    <div class="odt-startup__ring odt-startup__ring--outer"></div>
    <div class="odt-startup__orbit"></div>
    <div class="odt-startup__orbit odt-startup__orbit--second"></div>
    <div class="odt-startup__orbit odt-startup__orbit--third"></div>
    <div class="odt-startup__mark">
      <img src="./favicon.svg" alt="" width="72" height="72" />
    </div>
  </div>
  <p class="odt-startup__title">OpenDucktor</p>
  <p class="odt-startup__failure" data-odt-startup-status></p>
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
