import {
  defaultHighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, highlightSpecialChars, lineNumbers } from "@codemirror/view";
import { memo, type ReactElement, useEffect, useLayoutEffect, useRef } from "react";

type CodePreviewTheme = "dark" | "light";

type TaskExecutionCodePreviewProps = {
  className?: string;
  contents: string;
  fileName: string;
  theme: CodePreviewTheme;
};

const codePreviewTheme = (theme: CodePreviewTheme): Extension => [
  syntaxHighlighting(theme === "dark" ? oneDarkHighlightStyle : defaultHighlightStyle, {
    fallback: true,
  }),
  EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--card)",
        color: "var(--foreground)",
        fontSize: "12px",
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
        lineHeight: "18px",
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: "transparent",
        padding: "8px 0",
      },
      ".cm-line": {
        padding: "0 12px 0 8px",
      },
      ".cm-gutters": {
        backgroundColor: "var(--card)",
        border: "none",
        color: "var(--muted-foreground)",
        padding: "8px 0",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "3ch",
        padding: "0 8px 0 6px",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--selected-surface)",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      "&.cm-focused": {
        outline: "none",
      },
    },
    { dark: theme === "dark" },
  ),
];

export const findCodePreviewLanguage = (fileName: string): LanguageDescription | null =>
  LanguageDescription.matchFilename(languages, fileName);

export const TaskExecutionCodePreview = memo(function TaskExecutionCodePreview({
  className,
  contents,
  fileName,
  theme,
}: TaskExecutionCodePreviewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialConfigRef = useRef({ contents, fileName, theme });
  const appliedThemeRef = useRef(theme);
  const languageCompartmentRef = useRef(new Compartment());
  const themeCompartmentRef = useRef(new Compartment());

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const initialConfig = initialConfigRef.current;

    const view = new EditorView({
      parent: host,
      doc: initialConfig.contents,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": `Contents of ${initialConfig.fileName}`,
        }),
        languageCompartmentRef.current.of([]),
        themeCompartmentRef.current.of(codePreviewTheme(initialConfig.theme)),
      ],
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === contents) {
      return;
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: contents } });
  }, [contents]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || appliedThemeRef.current === theme) {
      return;
    }
    appliedThemeRef.current = theme;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(codePreviewTheme(theme)),
    });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return undefined;
    }
    const language = findCodePreviewLanguage(fileName);
    let active = true;

    if (!language) {
      view.dispatch({ effects: languageCompartmentRef.current.reconfigure([]) });
      return undefined;
    }

    void language
      .load()
      .then((support) => {
        if (!active || !viewRef.current) {
          return;
        }
        view.dispatch({ effects: languageCompartmentRef.current.reconfigure(support) });
      })
      .catch((cause: unknown) => {
        console.error(`Unable to load syntax highlighting for '${fileName}'.`, cause);
      });

    return () => {
      active = false;
    };
  }, [fileName]);

  const resolvedClassName = className
    ? `h-full min-h-0 overflow-hidden ${className}`
    : "h-full min-h-0 overflow-hidden";
  return <div ref={hostRef} className={resolvedClassName} />;
});
