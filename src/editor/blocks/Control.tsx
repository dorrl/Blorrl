import type { ReactNode, DragEvent, MouseEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import type { Block } from "../../language";
import { catalog } from "../blockCatalog";
type ValueSlotRenderer = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) => ReactNode;

type IfConditionFieldProps = {
  block: Block;
  conditionBlock?: Block;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  renderValueSlot: ValueSlotRenderer;
  onDrop: (event: DragEvent, targetId?: string) => void;
};

/** Condition socket UI for an if block. */
export function IfConditionField({
  block,
  conditionBlock,
  updateBlock,
  renderValueSlot,
  onDrop,
}: IfConditionFieldProps) {
  const condition = conditionBlock ?? block.conditionBlock;

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

type ControlBlockBodyProps = {
  block: Block;
  selected: string[];
  onDrop: (event: DragEvent, targetId?: string) => void;
  onSelectBlock: (event: MouseEvent, id: string) => void;
  onDragStart: (event: DragEvent, ids: string[]) => void;
  onBlockDragEnd: (event: DragEvent) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  updateBranch: (branchId: string, condition: string) => void;
  addElseIf: (id: string) => void;
  toggleElse: (id: string) => void;
};

/** Nested body and conditional branches for if/repeat statement blocks. */
export function ControlBlockBody({
  block,
  selected,
  onDrop,
  onSelectBlock,
  onDragStart,
  onBlockDragEnd,
  updateBlock,
  updateBranch,
  addElseIf,
  toggleElse,
}: ControlBlockBodyProps) {
  return (
    <div
      className="nested-flow"
      data-drop-into={block.id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, block.id)}
    >
      {(block.children ?? []).map((child, index) => (
        <div
          className="nested-item"
          key={child.id}
          data-block-id={child.id}
          data-drop-into={child.kind === "if" || child.kind === "repeat" ? child.id : undefined}
          draggable
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.stopPropagation();
            onDrop(event, child.id);
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelectBlock(event, child.id);
          }}
          onDragStart={(event) =>
            onDragStart(
              event,
              selected.includes(child.id)
                ? selected
                : (block.children ?? []).slice(index).map((sibling) => sibling.id),
            )
          }
          onDragEnd={onBlockDragEnd}
        >
          <span className="nested-grip"><GripVertical size={12} /></span>
          <strong>{catalog.find((item) => item.kind === child.kind)?.label ?? child.kind}</strong>
          {(child.kind === "let" || child.kind === "input") && (
            <input
              aria-label="Nested variable name"
              value={child.name ?? ""}
              onChange={(event) => updateBlock(child.id, { name: event.target.value })}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <input
            className="nested-expression"
            aria-label="Nested block value"
            value={child.value}
            onChange={(event) => updateBlock(child.id, { value: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ))}
      {!(block.children ?? []).length && (
        <div className="nested-empty">Drop blocks into this area</div>
      )}
      {block.kind === "if" &&
        (block.elseIf ?? []).map((branch) => (
          <div
            className="branch-panel"
            key={branch.id}
            data-drop-into={branch.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, branch.id)}
          >
            <label className="branch-heading">
              ELSE IF{" "}
              <input
                value={branch.condition}
                onChange={(event) => updateBranch(branch.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
            </label>
            <div className="nested-label">BRANCH BODY</div>
            {branch.children.map((child) => (
              <div className="nested-item" key={child.id}>
                <strong>{catalog.find((item) => item.kind === child.kind)?.label ?? child.kind}</strong>
                <input
                  className="nested-expression"
                  aria-label="Else-if block value"
                  value={child.value}
                  onChange={(event) => updateBlock(child.id, { value: event.target.value })}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            ))}
          </div>
        ))}
      {block.kind === "if" && block.elseChildren && (
        <div
          className="branch-panel"
          data-drop-into={block.elseId}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => block.elseId && onDrop(event, block.elseId)}
        >
          <div className="branch-heading">ELSE</div>
          {block.elseChildren.map((child) => (
            <div className="nested-item" key={child.id}>
              <strong>{catalog.find((item) => item.kind === child.kind)?.label ?? child.kind}</strong>
              <input
                className="nested-expression"
                aria-label="Else block value"
                value={child.value}
                onChange={(event) => updateBlock(child.id, { value: event.target.value })}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          ))}
        </div>
      )}
      {block.kind === "if" && (
        <div className="branch-actions">
          <button onClick={(event) => { event.stopPropagation(); addElseIf(block.id); }}>
            <Plus size={11} /> Else if
          </button>
          <button onClick={(event) => { event.stopPropagation(); toggleElse(block.id); }}>
            <Plus size={11} /> Else
          </button>
        </div>
      )}
    </div>
  );
}
