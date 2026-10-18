import type { ReactNode } from "react";
import type { Block, ValueType } from "../../language";
type ValueSlotRenderer = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) => ReactNode;

type ValueTypeSelectorProps = {
  block: Block;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  onUpdateType: (id: string, type: ValueType, checked: boolean) => void;
};

export function ValueTypeSelector({
  block,
  title,
  isOpen,
  onToggle,
  onUpdateType,
}: ValueTypeSelectorProps) {
  const types: ValueType[] = block.types ?? ["number"];

  return (
    <>
      <button
        className="type-panel-button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        Types · {types.join(", ")}
      </button>
      {isOpen && (
        <div
          className="type-panel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{title}</strong>
          {(["number", "string", "boolean"] as ValueType[]).map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={types.includes(type)}
                onChange={(event) =>
                  onUpdateType(block.id, type, event.target.checked)
                }
              />
              {type}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

type VariableBlockProps = {
  block: Block;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  renderValueSlot: ValueSlotRenderer;
  typePanelOpen: boolean;
  onToggleTypePanel: () => void;
  onUpdateType: (id: string, type: ValueType, checked: boolean) => void;
};

/** UI for variable declaration blocks. */
export function VariableBlock({
  block,
  updateBlock,
  renderValueSlot,
  typePanelOpen,
  onToggleTypePanel,
  onUpdateType,
}: VariableBlockProps) {
  return (
    <>
      <input
        value={block.name ?? ""}
        onChange={(event) => updateBlock(block.id, { name: event.target.value })}
        onClick={(event) => event.stopPropagation()}
        />
      <label>
        =
        {renderValueSlot(block, "valueBlock", block.value, "Variable value")}
      </label>
      <label className="const-toggle">
        <input
          type="checkbox"
          checked={!!block.constant}
          onChange={(event) => updateBlock(block.id, { constant: event.target.checked })}
          onClick={(event) => event.stopPropagation()}
        />{" "}
        const
      </label>
      <ValueTypeSelector
        block={block}
        title="Variable types"
        isOpen={typePanelOpen}
        onToggle={onToggleTypePanel}
        onUpdateType={onUpdateType}
      />
    </>
  );
}

type InputBlockProps = {
  block: Block;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  typePanelOpen: boolean;
  onToggleTypePanel: () => void;
  onUpdateType: (id: string, type: ValueType, checked: boolean) => void;
};

/** UI for terminal input blocks. */
export function InputBlock({
  block,
  updateBlock,
  typePanelOpen,
  onToggleTypePanel,
  onUpdateType,
}: InputBlockProps) {
  return (
    <>
      <label>
        At
        <input
          value={block.name ?? ""}
          onChange={(event) => updateBlock(block.id, { name: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        />
      </label>
      <ValueTypeSelector
        block={block}
        title="Input types"
        isOpen={typePanelOpen}
        onToggle={onToggleTypePanel}
        onUpdateType={onUpdateType}
      />
    </>
  );
}
