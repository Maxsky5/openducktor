// The Artifacts tab of task-artifacts.tsx in the session page `root`, with ArtifactCollection.tsx
// and ArtifactFile.tsx: a save adds a file to the collection, and a click on its row opens it. The
// app renders each change at once, with no motion.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { ArtifactGroups } from "./model";

/** The parts of the Artifacts tab, and the steps that change it. */
type ArtifactTabSteps = {
  /** The row of the artifact `id` in the collection. */
  row: (id: string) => HTMLElement;
  /** The Expand button of the open file. */
  expand: HTMLElement;
  showCollection: () => void;
  addFiles: (at: number) => void;
  open: (at: number) => void;
};

/** The controller of the Artifacts tab in `root`. */
export function artifactTab(scene: Scene, root: HTMLElement): ArtifactTabSteps {
  const collection = must(root, '[data-artifact-view="collection"]');
  const file = must(root, '[data-artifact-view="file"]');
  const group = (id: keyof ArtifactGroups): HTMLElement =>
    must(collection, `[data-artifact-group="${id}"]`);

  /** Build time: the tab shows the collection without the files, as before the first save. */
  const showCollection = (): void => {
    collection.hidden = false;
    file.hidden = true;
    group("files").hidden = true;
  };

  /** The first saved file adds the Files group under the workflow documents. */
  const addFiles = (at: number): void =>
    scene.at(at, () => {
      group("files").hidden = false;
    });

  /**
   * Opens the file, as a click on its row does: the file takes the place of the collection. The
   * page shows at once, as when its preview has loaded.
   */
  const open = (at: number): void =>
    scene.at(at, () => {
      collection.hidden = true;
      file.hidden = false;
    });

  return {
    row: (id: string): HTMLElement => must(collection, `[data-artifact-id="${id}"]`),
    expand: must(file, "[data-artifact-expand]"),
    showCollection,
    addFiles,
    open,
  };
}
