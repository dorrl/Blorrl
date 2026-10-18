import type { Block, ValueType } from "../../language";

type ValueTypeSelectorProps = {
  block: Block;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  onUpdateType: (id: string, type: ValueType, checked: boolean) => void;
};

export function ValueTypeSelector({
  block,
  title,
  isOpen,
  onToggle,
  onUpdateType,
}: ValueTypeSelectorProps) {
  const types: ValueType[] = block.types ?? ["number"];

  return (
    <>
      <button
        className="type-panel-button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        Types · {types.join(", ")}
      </button>
      {isOpen && (
        <div
          className="type-panel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{title}</strong>
          {(["number", "string", "boolean"] as ValueType[]).map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={types.includes(type)}
                onChange={(event) =>
                  onUpdateType(block.id, type, event.target.checked)
                }
              />
              {type}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
