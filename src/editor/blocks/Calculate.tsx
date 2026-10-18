import type { ReactNode } from "react";
import type { Block } from "../../language";
type ValueSlotRenderer = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) => ReactNode;
type ExpressionBlockProps = { block: Block; renderValueSlot: ValueSlotRenderer; updateBlock: (id: string, patch: Partial<Block>) => void };
export function Calculate({block,renderValueSlot,updateBlock}:ExpressionBlockProps):ReactNode { if(block.kind!=="add")return null; return <span className="inline-reporter kind-add"><span className="inline-operator-fields">{renderValueSlot(block,"valueBlock",block.value,"Left value")}<select aria-label="Calculate operator" value={block.operator??"+"} onChange={event=>updateBlock(block.id,{operator:event.target.value as Block["operator"]})} onClick={event=>event.stopPropagation()}><option>+</option><option>-</option><option>*</option><option>/</option></select>{renderValueSlot(block,"rightBlock",block.right??"1","Right value")}</span></span>; }
