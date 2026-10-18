import type { DragEvent, ReactNode } from "react";
import type { Block } from "../../language";
import { ReporterContent } from "./ReporterContent";
import { Calculate } from "./Calculate";
import { Compare } from "./Compare";

type ValueSlotRenderer = (
  owner: Block,
  field: "valueBlock" | "rightBlock",
  value: string,
  ariaLabel: string,
) => ReactNode;

type ValueSlotProps = {
  owner: Block;
  field: "valueBlock" | "rightBlock";
  value: string;
  ariaLabel: string;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  onDrop: (event: DragEvent, targetId?: string) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  renderValueSlot: ValueSlotRenderer;
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
}: ValueSlotProps) {
  const nested = field === "valueBlock" ? owner.valueBlock : owner.rightBlock;

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
        <>
          <span
            className={"value-chip kind-" + nested.kind}
            draggable
            onDragStart={(event) => onDragStart(event, nested.id)}
          >
            {nested.kind === "add" ? <Calculate block={nested} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /> : nested.kind === "compare" ? <Compare block={nested} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /> : <ReporterContent block={nested} updateBlock={updateBlock} />}
          </span>
        </>
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
