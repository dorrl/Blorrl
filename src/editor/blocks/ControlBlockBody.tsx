import type { DragEvent, MouseEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import type { Block } from "../../language";
import { catalog } from "../blockCatalog";

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
      <div className="nested-label">
        {block.kind === "if" ? "THEN" : "REPEAT BODY"} <span>DROP BLOCKS HERE</span>
      </div>
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
