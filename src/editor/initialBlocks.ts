import type { Block } from "../language";

export const initialBlocks: Block[] = [
  { id: "b1", kind: "print", value: "Hello from Blorrl!" },
  { id: "b2", kind: "let", name: "answer", value: "42", types: ["number"] },
  { id: "b3", kind: "print", value: "", valueBlock: { id: "b3-value", kind: "get", value: "answer" } },
];
