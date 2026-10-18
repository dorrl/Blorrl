import type { ReactNode } from "react";
import type { DragEvent } from "react";
import type { Block } from "../../language";

type ValueSlotRenderer = (
  owner: Block,
  field: "valueBlock" | "rightBlock",
  value: string,
  ariaLabel: string,
) => ReactNode;

type IfConditionFieldProps = {
  block: Block;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  renderValueSlot: ValueSlotRenderer;
  onDrop: (event: DragEvent, targetId?: string) => void;
};

/** Condition socket UI for an if block. */
export function IfConditionField({
  block,
  updateBlock,
  renderValueSlot,
  onDrop,
}: IfConditionFieldProps) {
  const condition = block.conditionBlock;

  return (
    <div
      className="condition-slot"
      data-condition-for={block.id}
      onDragOver={(event) => {
        event.preventDefault();
        event.currentTarget.classList.add("condition-hover");
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove("condition-hover")}
      onDrop={(event) => {
        event.currentTarget.classList.remove("condition-hover");
        onDrop(event, "condition:" + block.id);
      }}
    >
      {condition ? (
        condition.kind === "compare" ? (
          <>
            {renderValueSlot(condition, "valueBlock", condition.value, "Left condition value")}
            <select
              aria-label="Condition operator"
              value={condition.comparisonOperator ?? "=="}
              onChange={(event) =>
                updateBlock(condition.id, {
                  comparisonOperator: event.target.value as Block["comparisonOperator"],
                })
              }
            >
              <option>==</option>
              <option>&gt;=</option>
              <option>&lt;=</option>
            </select>
            {renderValueSlot(
              condition,
              "rightBlock",
              condition.right ?? "0",
              "Right condition value",
            )}
          </>
        ) : (
          <strong>{condition.kind === "true" ? "True" : "False"}</strong>
        )
      ) : (
        <span>Drop Boolean</span>
      )}
    </div>
  );
}
