import type { Block, BlockKind } from "../language";

const reporterKinds = new Set<BlockKind>(["add", "compare", "true", "false", "get"]);
const statementKinds = new Set<BlockKind>(["print", "let", "input", "if", "repeat"]);
const valueOwnerKinds = new Set<BlockKind>(["print", "let", "repeat", "add", "compare"]);

export type GraphValidation = { valid: boolean; errors: string[] };

/**
 * Validate a proposed block graph before committing a drag/drop operation.
 * This is intentionally pure: preview and final drop can validate the same
 * candidate without changing editor state.
 */
export function validateBlockGraph(roots: Block[]): GraphValidation {
  const errors: string[] = [];
  const blocks: Block[] = [];
  const ids = new Map<string, Block>();
  const objectStack = new Set<Block>();

  const visit = (block: Block) => {
    if (objectStack.has(block)) {
      errors.push(`Object cycle detected at block "${block.id}".`);
      return;
    }
    const previous = ids.get(block.id);
    if (previous && previous !== block) {
      errors.push(`Duplicate block id "${block.id}".`);
      return;
    }
    if (previous) return;
    ids.set(block.id, block);
    blocks.push(block);
    objectStack.add(block);
    if (block.valueBlock) visit(block.valueBlock);
    if (block.rightBlock) visit(block.rightBlock);
    if (block.conditionBlock) visit(block.conditionBlock);
    for (const child of block.children ?? []) visit(child);
    for (const branch of block.elseIf ?? []) for (const child of branch.children) visit(child);
    for (const child of block.elseChildren ?? []) visit(child);
    objectStack.delete(block);
  };

  for (const block of roots) visit(block);

  const occupiedConnections = new Map<string, string>();
  const parentEdges = new Map<string, string>();

  for (const block of blocks) {
    const parentId = block.attachedTo;
    const type = block.attachmentType;
    const field = block.attachmentField;

    if (!parentId) {
      if (type || field) errors.push(`Block "${block.id}" has connection metadata without a parent.`);
      continue;
    }

    if (parentId === block.id) {
      errors.push(`Block "${block.id}" cannot connect to itself.`);
      continue;
    }
    if (parentId !== "__start" && !ids.has(parentId)) {
      errors.push(`Block "${block.id}" references missing parent "${parentId}".`);
      continue;
    }

    if (parentId !== "__start") parentEdges.set(block.id, parentId);

    const effectiveType = type ?? (reporterKinds.has(block.kind) ? "value" : "stack");
    if (effectiveType === "value") {
      if (!reporterKinds.has(block.kind)) {
        errors.push(`Statement block "${block.id}" cannot occupy a value socket.`);
      }
      if (field !== "valueBlock" && field !== "rightBlock") {
        errors.push(`Value block "${block.id}" has an invalid socket field.`);
      }
      const parent = ids.get(parentId);
      if (parent && !valueOwnerKinds.has(parent.kind)) {
        errors.push(`Block "${parent.id}" does not support value sockets.`);
      }
      if (field) {
        const key = parentId + ":value:" + field;
        const owner = occupiedConnections.get(key);
        if (owner && owner !== block.id) errors.push(`Socket "${key}" has multiple blocks.`);
        occupiedConnections.set(key, block.id);
      }
    } else if (effectiveType === "condition") {
      if (!["true", "false", "compare"].includes(block.kind)) {
        errors.push(`Block "${block.id}" is not a valid condition reporter.`);
      }
      if (field !== "conditionBlock") errors.push(`Condition block "${block.id}" has an invalid socket field.`);
      const parent = ids.get(parentId);
      if (parent && parent.kind !== "if") errors.push(`Block "${parent.id}" does not support condition sockets.`);
      const key = parentId + ":condition:" + String(field);
      const owner = occupiedConnections.get(key);
      if (owner && owner !== block.id) errors.push(`Socket "${key}" has multiple blocks.`);
      occupiedConnections.set(key, block.id);
    } else {
      if (reporterKinds.has(block.kind)) errors.push(`Reporter block "${block.id}" cannot connect as a statement.`);
      if (field) errors.push(`Statement block "${block.id}" cannot have a socket field.`);
      const parent = ids.get(parentId);
      if (parentId === "__start") {
        if (!statementKinds.has(block.kind)) errors.push(`Block "${block.id}" cannot attach to Start.`);
      } else if (parent && !statementKinds.has(parent.kind)) {
        errors.push(`Block "${parent.id}" cannot have a statement successor.`);
      }
      const key = parentId + ":stack";
      const owner = occupiedConnections.get(key);
      if (owner && owner !== block.id) errors.push(`Statement connection "${key}" has multiple successors.`);
      occupiedConnections.set(key, block.id);
    }
  }

  for (const block of blocks) {
    const path = new Set<string>();
    let current: string | undefined = block.id;
    while (current && current !== "__start") {
      if (path.has(current)) {
        errors.push(`Connection cycle detected at block "${current}".`);
        break;
      }
      path.add(current);
      current = parentEdges.get(current);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
