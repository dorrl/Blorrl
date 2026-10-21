export type BlockKind = "print" | "let" | "input" | "get" | "if" | "repeat" | "add" | "true" | "false" | "compare";
export type ValueType = "number" | "string" | "boolean";
export type Branch = { id: string; condition: string; children: Block[] };
export type Block = {
  id: string; kind: BlockKind; value: string; attachedTo?: string;
  /** Connection metadata is separate from the block's own data. */
  attachmentType?: "stack" | "value" | "condition";
  attachmentField?: "valueBlock" | "rightBlock" | "conditionBlock";
  name?: string; constant?: boolean; right?: string; valueBlock?: Block; rightBlock?: Block;
  operator?: "+" | "-" | "*" | "/"; comparisonOperator?: "==" | ">" | "<" | ">=" | "<="; types?: ValueType[]; children?: Block[]; conditionBlock?: Block;
  elseIf?: Branch[]; elseChildren?: Block[]; elseId?: string;
};