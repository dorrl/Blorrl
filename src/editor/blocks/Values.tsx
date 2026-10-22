import type { DragEvent, ReactNode } from "react";
import type { Block } from "../../language";
import { Calculate } from "./Calculate";
import { Compare } from "./Compare";
import { catalog } from "../blockCatalog";
function valueCategoryClass(kind: Block["kind"]) {
  return "category-" + (catalog.find(item => item.kind === kind)?.category ?? "Values").toLowerCase();
}
type ValueSlotRenderer = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) => ReactNode;

type ReporterContentProps={block:Block;updateBlock:(id:string,patch:Partial<Block>)=>void};
/** Simple value reporters; Calculate and Compare have dedicated components. */
export function ReporterContent({block,updateBlock}:ReporterContentProps):ReactNode { if(block.kind==="get")return <span className="inline-get">get{" "}<input aria-label="Variable name" value={block.value} onChange={event=>updateBlock(block.id,{value:event.target.value})} onClick={event=>event.stopPropagation()}/></span>; if(block.kind==="true")return "true"; if(block.kind==="false")return "false"; return block.kind; }

type ValueSlotProps = {
  owner: Block;
  field: "valueBlock" | "rightBlock";
  value: string;
  ariaLabel: string;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  onDrop: (event: DragEvent, targetId?: string) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  renderValueSlot: ValueSlotRenderer;
  nestedBlock?: Block;
};

/** Shared input/drop target used by block values and expression reporters. */
export function ValueSlot({
  owner,
  field,
  value,
  ariaLabel,
  updateBlock,
  onDrop,
  onDragStart,
  renderValueSlot,
  nestedBlock,
}: ValueSlotProps) {
  const nested = nestedBlock ?? (field === "valueBlock" ? owner.valueBlock : owner.rightBlock);

  return (
    <div
      className="value-slot"
      data-value-for={owner.id}
      data-value-field={field}
      onDragOver={(event) => {
        event.preventDefault();
        event.currentTarget.classList.add("value-hover");
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove("value-hover")}
      onDrop={(event) => {
        event.currentTarget.classList.remove("value-hover");
        onDrop(event, `value:${owner.id}:${field}`);
      }}
    >
      {nested ? (
        <span
          data-block-id={nested.id}
          className={"block-card value-block-model value-chip " + valueCategoryClass(nested.kind) + " kind-" + nested.kind}
          style={{ position: "relative", left: "auto", top: "auto", zIndex: "auto", flex: "0 0 auto" }}
          draggable
          onDragStart={(event) => onDragStart(event, nested.id)}
        >
          <span className="block-content">
            <span className="block-fields">
              {nested.kind === "add" ? <Calculate block={nested} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /> : nested.kind === "compare" ? <Compare block={nested} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /> : <ReporterContent block={nested} updateBlock={updateBlock} />}
            </span>
          </span>
        </span>
      ) : (
        <input
          className="value-input"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) =>
            updateBlock(
              owner.id,
              field === "valueBlock"
                ? { value: event.target.value }
                : { right: event.target.value },
            )
          }
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
}
