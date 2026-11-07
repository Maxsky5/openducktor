// The model picker popover of model-picker.tsx: a rail with Favorites and one button for each
// runtime, a search field, and the models of the selected runtime. Each runtime list is in the
// markup. `data-view` shows one list, as the rail does in the product.
import { FileText, Image, Star } from "lucide-react";
import type { ReactElement } from "react";
import { CATALOGS, modelKey, RUNTIMES, type RuntimeKind } from "../../sample/models";
import { flag } from "../flag";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import "./ModelPicker.css";

export type ModelPickerProps = {
  /** The runtime whose models the list shows. */
  view: RuntimeKind;
  /** The key of the selected model. */
  selected: string;
};

export function ModelPicker({ view, selected }: ModelPickerProps): ReactElement {
  return (
    <div className="mp" data-picker="" data-view={view}>
      <div className="mp-rail">
        <span className="mp-rail-button" data-rail="favorites">
          <Star />
        </span>
        {RUNTIMES.map((kind) => (
          <span className="mp-rail-button" data-rail={kind} key={kind}>
            <RuntimeIcon kind={kind} />
          </span>
        ))}
      </div>
      <div className="mp-main">
        <div className="mp-search">
          <span className="mp-input">Search models...</span>
        </div>
        {RUNTIMES.map((kind) => (
          <ul className="mp-list" data-list={kind} key={kind}>
            {CATALOGS[kind].map((model) => {
              const key = modelKey({ runtime: kind, model: model.id });
              return (
                <li
                  className="mp-row"
                  data-selected={flag(selected === key)}
                  data-model={key}
                  key={key}
                >
                  <span className="mp-pick" data-model-pick="">
                    <RuntimeIcon kind={kind} />
                    <span className="mp-name">
                      <b>{model.name}</b>
                      <small>{`${model.provider} · ${model.id}`}</small>
                    </span>
                    <span className="mp-meta">
                      {model.capabilities.includes("image") && <Image className="i14" />}
                      {model.capabilities.includes("pdf") && <FileText className="i14" />}
                      {model.context && <span>{`${model.context} context`}</span>}
                    </span>
                  </span>
                  <span className="mp-star">
                    <Star />
                  </span>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </div>
  );
}
