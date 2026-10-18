import type { ReactNode } from "react";
import type { Block } from "../../language";
type ValueSlotRenderer = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) => ReactNode;


type PrintBlockProps = {
  block: Block;
  renderValueSlot: ValueSlotRenderer;
};

/** UI for the Print statement's text/value input. */
export function PrintBlock({ block, renderValueSlot }: PrintBlockProps) {
  return (
    <label className="wide-field">
      {renderValueSlot(
        block,
        "valueBlock",
        block.value,
        "Print text or drop a value block",
      )}
    </label>
  );
}
