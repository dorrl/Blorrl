import type { Block, BlockKind } from "../language";

/** Create a new block with the same default values used by the editor palette. */
export function createBlock(kind: BlockKind): Block {
  const block: Block = {
    id: crypto.randomUUID(),
    kind,
    value:
      kind === "print"
        ? "Hello!"
        : kind === "get"
          ? "value"
          : kind === "true"
            ? "true"
            : kind === "false"
              ? "false"
              : "1",
  };

  if (kind === "let" || kind === "input") {
    block.name = "value";
    block.types = ["number"];
  }
  if (kind === "add") {
    block.right = "1";
    block.operator = "+";
  }
  if (kind === "compare") {
    block.right = "0";
    block.comparisonOperator = "==";
  }
  if (kind === "if") {
    block.children = [];
    block.conditionBlock = {
      id: crypto.randomUUID(),
      kind: "false",
      value: "false",
    };
  }
  if (kind === "repeat") block.children = [];

  return block;
}

/** Recursively apply a patch to a block in the project tree. */
export function updateBlockTree(
  items: Block[],
  id: string,
  patch: Partial<Block>,
): Block[] {
  return items.map((block) =>
    block.id === id
      ? { ...block, ...patch }
      : {
          ...block,
          conditionBlock: block.conditionBlock
            ? updateBlockTree([block.conditionBlock], id, patch)[0]
            : undefined,
          valueBlock: block.valueBlock
            ? updateBlockTree([block.valueBlock], id, patch)[0]
            : undefined,
          rightBlock: block.rightBlock
            ? updateBlockTree([block.rightBlock], id, patch)[0]
            : undefined,
          children: updateBlockTree(block.children ?? [], id, patch),
          elseIf: block.elseIf?.map((branch) => ({
            ...branch,
            children: updateBlockTree(branch.children, id, patch),
          })),
          elseChildren: block.elseChildren
            ? updateBlockTree(block.elseChildren, id, patch)
            : undefined,
        },
  );
}
