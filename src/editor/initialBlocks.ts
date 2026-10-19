import type { Block } from "../language";

export const initialBlocks: Block[] = [
  { id: "init1", kind: "let", name: "var", value: "Hello World", types: ["string"], attachedTo: "__start" },
  { id: "init2", kind: "print", value: "", valueBlock: { id: "init3", kind: "get", value: "var" }, attachedTo: "init1" },
];
