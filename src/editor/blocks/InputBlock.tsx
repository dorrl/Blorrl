import type { Block, ValueType } from "../../language";
import { ValueTypeSelector } from "./ValueTypeSelector";

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
        STORE AS
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
      <span className="field-hint">Reads one line from terminal input</span>
    </>
  );
}
