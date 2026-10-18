import type { BlockKind } from "../language";

export const catalog: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: "print", label: "Print", hint: "Write a value to terminal" },
  { kind: "let", label: "Variable", hint: "Store a value" },
  { kind: "input", label: "Input", hint: "Read a line from stdin" },
  { kind: "get", label: "Get variable", hint: "Output a variable value" },
  { kind: "if", label: "If condition", hint: "Run a block when true" },
  { kind: "repeat", label: "Repeat", hint: "Repeat a number of times" },
  { kind: "add", label: "Calculate", hint: "Drag into a value socket" },
  { kind: "true", label: "True", hint: "Boolean true value" },
  { kind: "false", label: "False", hint: "Boolean false value" },
  { kind: "compare", label: "==", hint: "Compare values; drag into a value socket" },
];
