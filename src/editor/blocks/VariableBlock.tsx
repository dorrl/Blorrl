import type { ReactNode } from "react";
import type { Block, ValueType } from "../../language";
import { ValueTypeSelector } from "./ValueTypeSelector";

type ValueSlotRenderer = (
  owner: Block,
  field: "valueBlock" | "rightBlock",
  value: string,
  ariaLabel: string,
) => ReactNode;

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
      <label>
        NAME
        <input
          value={block.name ?? ""}
          onChange={(event) => updateBlock(block.id, { name: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        />
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
      <label>
        VALUE
        {renderValueSlot(block, "valueBlock", block.value, "Variable value")}
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
