import type { BlockKind } from "../language";

// Reorder entries here to change display order within each category.
export const catalog: { kind: BlockKind; label: string; hint: string; category: "Output" | "Variables" | "Control" | "Values" }[] = [
  { kind: "print", label: "Print", hint: "Write a value to terminal", category: "Output" },
  { kind: "let", label: "Set", hint: "Store a value", category: "Variables" },
  { kind: "input", label: "Input", hint: "Read a line from stdin", category: "Variables" },
  { kind: "get", label: "Get", hint: "Read a variable value", category: "Variables" },
  { kind: "if", label: "If", hint: "Run a block when true", category: "Control" },
  { kind: "repeat", label: "Repeat", hint: "Repeat a number of times", category: "Control" },
  { kind: "add", label: "Calculate", hint: "Drag into a value socket", category: "Values" },
  { kind: "true", label: "True", hint: "Boolean true value", category: "Values" },
  { kind: "false", label: "False", hint: "Boolean false value", category: "Values" },
  { kind: "compare", label: "Compare", hint: "Compare values; drag into a value socket", category: "Values" },
];
