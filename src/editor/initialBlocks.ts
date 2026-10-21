import type { Block } from "../language";

export const initialBlocks: Block[] = [
  { id: "init1", kind: "let", name: "var", value: "Hello World", types: ["string"], attachedTo: "__start", attachmentType: "stack" },
  { id: "init2", kind: "print", value: "", attachedTo: "init1", attachmentType: "stack" },
  { id: "init3", kind: "get", value: "var", attachedTo: "init2", attachmentType: "value", attachmentField: "valueBlock" },
];
