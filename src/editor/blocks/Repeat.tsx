import type { ReactNode } from "react";
import type { Block } from "../../language";

type ValueSlotRenderer = (
  owner: Block,
  field: "valueBlock" | "rightBlock",
  value: string,
  ariaLabel: string,
) => ReactNode;

type RepeatBlockProps = {
  block: Block;
  renderValueSlot: ValueSlotRenderer;
};

/** Repeat count field UI. The loop body remains rendered by the editor. */
export function RepeatBlock({ block, renderValueSlot }: RepeatBlockProps) {
  return (
    <label>
      {renderValueSlot(block, "valueBlock", block.value, "Repeat count")}
    </label>
  );
}
