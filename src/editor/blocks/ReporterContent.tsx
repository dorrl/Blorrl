import type { ReactNode } from "react";
import type { Block } from "../../language";

type ValueSlotRenderer = (
  owner: Block,
  field: "valueBlock" | "rightBlock",
  value: string,
  ariaLabel: string,
) => ReactNode;

type ReporterContentProps = {
  block: Block;
  renderValueSlot: ValueSlotRenderer;
  updateBlock: (id: string, patch: Partial<Block>) => void;
};

/**
 * Renders expression/reporter blocks that can appear on the canvas,
 * inside value sockets, or in the snap preview.
 *
 * Editing and drag behavior remain owned by the editor for now. This keeps
 * this first extraction focused on presentation without changing state flow.
 */
export function ReporterContent({
  block,
  renderValueSlot,
  updateBlock,
}: ReporterContentProps): ReactNode {
  if (block.kind === "add" || block.kind === "compare") {
    return (
      <span className={"inline-reporter kind-" + block.kind}>
        <span className="inline-operator-fields">
          {renderValueSlot(block, "valueBlock", block.value, "Left value")}
          <select
            aria-label="Nested operator"
            value={
              block.kind === "compare"
                ? block.comparisonOperator ?? "=="
                : block.operator ?? "+"
            }
            onChange={(event) =>
              updateBlock(
                block.id,
                block.kind === "compare"
                  ? { comparisonOperator: event.target.value as Block["comparisonOperator"] }
                  : { operator: event.target.value as Block["operator"] },
              )
            }
            onClick={(event) => event.stopPropagation()}
          >
            {block.kind === "compare" ? (
              <>
                <option>==</option>
                <option>&gt;=</option>
                <option>&lt;=</option>
              </>
            ) : (
              <>
                <option>+</option>
                <option>-</option>
                <option>*</option>
                <option>/</option>
              </>
            )}
          </select>
          {renderValueSlot(
            block,
            "rightBlock",
            block.right ?? (block.kind === "compare" ? "0" : "1"),
            "Right value",
          )}
        </span>
      </span>
    );
  }

  if (block.kind === "get") {
    return (
      <span className="inline-get">
        get{" "}
        <input
          aria-label="Variable name"
          value={block.value}
          onChange={(event) => updateBlock(block.id, { value: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        />
      </span>
    );
  }

  if (block.kind === "true") return "true";
  if (block.kind === "false") return "false";
  return block.kind;
}
