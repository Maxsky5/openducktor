# Browser tabs

`BrowserTabs` renders reorderable tabs with a browser-style shape. It owns the tab shell, selection on mouse release, drag selection suppression, action isolation, and drag preview. `BrowserTabsBar` supplies horizontal scrolling and reveals the active tab when selection or layout changes.

## Composition

Use the existing shadcn `Tabs` root to share selection and keyboard behavior with the page content. Pass the same selected value and selection handler to `Tabs` and `BrowserTabs`.

```tsx
<Tabs value={selectedValue} onValueChange={selectTab}>
  <BrowserTabsBar createAction={<NewTabButton />} actions={<PageActions />}>
    <BrowserTabs
      aria-label="Open documents"
      selectedValue={selectedValue}
      onSelect={selectTab}
      onReorder={reorderTabs}
      items={documents.map((document) => ({
        value: document.id,
        content: document.title,
        action: <CloseButton onClick={() => closeDocument(document.id)} />,
      }))}
    />
  </BrowserTabsBar>
  <TabsContent value={selectedValue}>{content}</TabsContent>
</Tabs>
```

## Ownership

- Each caller owns its data, selected value, tab order, and action effects. `onReorder` reports the dragged ID, target ID, and placement before or after the target.
- Each item accepts display content, an optional action, trigger props, and optional data attributes. Put buttons in `action` so they do not start a drag or select the tab.
- The bar accepts optional create and page actions, a scroll ref, and a class name. Keep page themes and desktop titlebar spacing at the call site.
- Content and actions also render in the inert drag preview. They must support a second mounted instance. Trigger IDs and refs stay on the real tab.
- The module has no task, agent, workspace, or persistence dependencies. Keep those concerns in the page or feature that uses it.
