import type { Block } from "../language";

export const initialBlocks: Block[] = [
  { id: "b1", kind: "print", value: "Hello from Blorrl!", attachedTo: "__start" },
  { id: "b2", kind: "let", name: "answer", value: "42", types: ["number"], attachedTo: "b1" },
  { id: "b3", kind: "print", value: "", valueBlock: { id: "b3-value", kind: "get", value: "answer" }, attachedTo: "b2" },
];
