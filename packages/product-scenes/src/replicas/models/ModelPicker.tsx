// The popover of model-picker.tsx: a rail with Favorites and one button for each runtime, the
// search field, the models of the runtime that the rail shows, and the options bar of the selected
// model. Each runtime list is in the markup, and `data-view` shows one, as the rail does in the
// product. The options bar of each value in `options` is in the markup, and the bar of the selected
// value shows. No model is a favorite.
import { Check, FileText, Image, Search, Star } from "lucide-react";
import type { ReactElement } from "react";
import {
  CATALOGS,
  type ModelChoice,
  modelKey,
  RUNTIMES,
  type RuntimeKind,
} from "../../sample/models";
import { flag } from "../flag";
import { Input } from "../ui/Input";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { ModelOptions } from "./ModelOptions";
import "./ModelPicker.css";

export type ModelPickerProps = {
  /** The runtime whose models the list shows. */
  view: RuntimeKind;
  /** The selected model: its row shows the check, and its options show in the bar. */
  value: ModelChoice;
  /** The values whose options bar a scene can show. The value is one of them. */
  options: readonly ModelChoice[];
};

function ModelList({ kind, selected }: { kind: RuntimeKind; selected: string }): ReactElement {
  return (
    <ul className="mp-list" data-list={kind}>
      {CATALOGS[kind].map((model) => {
        const key = modelKey({ runtime: kind, model: model.id });
        return (
          <li className="mp-row" data-selected={flag(selected === key)} data-model={key} key={key}>
            <span className="mp-pick" data-model-pick="">
              <RuntimeIcon kind={kind} />
              <span className="mp-name">
                <b>{model.name}</b>
                <small>{`${model.provider} · ${model.id}`}</small>
              </span>
              <span className="mp-meta">
                {model.capabilities.length > 0 && (
                  <span className="mp-caps">
                    {model.capabilities.includes("image") && <Image className="i14" />}
                    {model.capabilities.includes("pdf") && <FileText className="i14" />}
                  </span>
                )}
                {model.context && <span>{`${model.context} context`}</span>}
                <Check className="i14 mp-check" />
              </span>
            </span>
            <span className="mp-star">
              <Star />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ModelPicker({ view, value, options }: ModelPickerProps): ReactElement {
  const selected = modelKey(value);
  if (!options.some((option) => modelKey(option) === selected)) {
    throw new Error(`The model picker has no options bar for ${selected}.`);
  }
  return (
    <div className="mp" data-picker="" data-view={view}>
      <div className="mp-body">
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
            <Input className="mp-input" placeholder="Search models..." data-search="">
              <Search className="i14 mp-search-icon" />
            </Input>
          </div>
          {RUNTIMES.map((kind) => (
            <ModelList kind={kind} selected={selected} key={kind} />
          ))}
        </div>
      </div>
      {options.map((option) => (
        <ModelOptions
          value={option}
          hidden={modelKey(option) !== selected}
          key={modelKey(option)}
        />
      ))}
    </div>
  );
}
