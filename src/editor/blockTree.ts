import type { Block } from "../language";
import { validateBlockGraph } from "./blockGraphValidation";

export const allBlocks = (items: Block[]): Block[] => {
  const found = new Map<string, Block>();
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      if (found.has(block.id)) continue;
      found.set(block.id, block);
      if (block.conditionBlock) visit([block.conditionBlock]);
      if (block.valueBlock) visit([block.valueBlock]);
      if (block.rightBlock) visit([block.rightBlock]);
      visit(block.children ?? []);
      for (const branch of block.elseIf ?? []) visit(branch.children);
      visit(block.elseChildren ?? []);
    }
  };
  visit(items);
  return [...found.values()];
};

/**
 * Convert older projects that stored socket blocks as nested objects into the
 * canonical flat block list. Every block remains the same Block model; the
 * owner/field relationship lives on the child as connection metadata.
 */
export function normalizeBlockGraph(items: Block[]): Block[] {
  const result: Block[] = [];
  const seen = new Set<string>();
  const visit = (block: Block, asRoot: boolean, inheritedParent?: string, inheritedField?: Block["attachmentField"]): Block => {
    const copy: Block = { ...block };
    const socketChildren: Array<{ child: Block; field: NonNullable<Block["attachmentField"]> }> = [];
    if (copy.valueBlock) socketChildren.push({ child: copy.valueBlock, field: "valueBlock" });
    if (copy.rightBlock) socketChildren.push({ child: copy.rightBlock, field: "rightBlock" });
    if (copy.conditionBlock) socketChildren.push({ child: copy.conditionBlock, field: "conditionBlock" });
    delete copy.valueBlock;
    delete copy.rightBlock;
    delete copy.conditionBlock;
    if (inheritedParent && inheritedField) {
      copy.attachedTo = inheritedParent;
      copy.attachmentField = inheritedField;
      copy.attachmentType = inheritedField === "conditionBlock" ? "condition" : "value";
    }
    if (asRoot && !seen.has(copy.id)) {
      seen.add(copy.id);
      result.push(copy);
    }
    for (const socket of socketChildren) {
      if (!seen.has(socket.child.id)) {
        const child = visit(socket.child, true, copy.id, socket.field);
        seen.add(child.id);
      } else {
        // A socket child may already have appeared earlier in the serialized array.
        // Update that same canonical object instead of leaving it as a loose block.
        const existing = result.find(item => item.id === socket.child.id);
        if (existing) {
          existing.attachedTo = copy.id;
          existing.attachmentField = socket.field;
          existing.attachmentType = socket.field === "conditionBlock" ? "condition" : "value";
        }
      }
    }
    copy.children = copy.children?.map(child => visit(child, false));
    copy.elseIf = copy.elseIf?.map(branch => ({ ...branch, children: branch.children.map(child => visit(child, false)) }));
    copy.elseChildren = copy.elseChildren?.map(child => visit(child, false));
    return copy;
  };
  for (const block of items) visit(block, true);
  return result;
}

/** Build a temporary nested view for the existing compiler and block fields. */
export function hydrateBlockGraph(items: Block[]): Block[] {
  const flat = allBlocks(items);
  const visiting = new Set<string>();
  const hydrated = new Map<string, Block>();
  const hydrate = (source: Block): Block => {
    const cached = hydrated.get(source.id);
    if (cached) return cached;
    if (visiting.has(source.id)) return { ...source };
    visiting.add(source.id);
    const copy: Block = { ...source };
    const value = flat.find(block => block.attachedTo === source.id && block.attachmentType === "value" && block.attachmentField === "valueBlock");
    const right = flat.find(block => block.attachedTo === source.id && block.attachmentType === "value" && block.attachmentField === "rightBlock");
    const condition = flat.find(block => block.attachedTo === source.id && block.attachmentType === "condition" && block.attachmentField === "conditionBlock");
    if (value) copy.valueBlock = hydrate(value);
    else delete copy.valueBlock;
    if (right) copy.rightBlock = hydrate(right);
    else delete copy.rightBlock;
    if (condition) copy.conditionBlock = hydrate(condition);
    else delete copy.conditionBlock;
    copy.children = source.children?.map(hydrate);
    copy.elseIf = source.elseIf?.map(branch => ({ ...branch, children: branch.children.map(hydrate) }));
    copy.elseChildren = source.elseChildren?.map(hydrate);
    visiting.delete(source.id);
    hydrated.set(source.id, copy);
    return copy;
  };
  return items
    .filter(block => block.attachmentType !== "value" && block.attachmentType !== "condition")
    .map(hydrate)
    .map(block => {
      // Socket-only blocks are omitted from the root list but still available
      // through their owner's valueBlock/rightBlock/conditionBlock properties.
      delete block.attachmentField;
      return block;
    });
}

export function removeIds(items: Block[], ids: string[]): Block[] {
  const removed = new Set(ids);
  const removeOne = (block: Block): Block | null => {
    if (removed.has(block.id)) return null;
    return {
      ...block,
      conditionBlock: block.conditionBlock ? removeOne(block.conditionBlock) ?? undefined : undefined,
      valueBlock: block.valueBlock ? removeOne(block.valueBlock) ?? undefined : undefined,
      rightBlock: block.rightBlock ? removeOne(block.rightBlock) ?? undefined : undefined,
      children: (block.children ?? []).map(removeOne).filter((item): item is Block => item !== null),
      elseIf: block.elseIf?.map(branch => ({ ...branch, children: branch.children.map(removeOne).filter((item): item is Block => item !== null) })),
      elseChildren: block.elseChildren?.map(removeOne).filter((item): item is Block => item !== null),
    };
  };
  return items.map(removeOne).filter((block): block is Block => block !== null);
}

export function putValue(items: Block[], targetId: string, field: "valueBlock" | "rightBlock", valueBlock: Block): Block[] {
  const oldIds = allBlocks(items)
    .filter(block => block.attachedTo === targetId && block.attachmentType === "value" && block.attachmentField === field)
    .map(block => block.id);
  const rest = removeIds(removeIds(items, oldIds), [valueBlock.id]);
  const child: Block = { ...valueBlock, attachedTo: targetId, attachmentType: "value", attachmentField: field };
  const candidate = [...rest, child];
  return validateBlockGraph(candidate).valid ? candidate : items;
}

export function putCondition(items: Block[], targetId: string, conditionBlock: Block): Block[] {
  const oldIds = allBlocks(items)
    .filter(block => block.attachedTo === targetId && block.attachmentType === "condition" && block.attachmentField === "conditionBlock")
    .map(block => block.id);
  const rest = removeIds(removeIds(items, oldIds), [conditionBlock.id]);
  const child: Block = { ...conditionBlock, attachedTo: targetId, attachmentType: "condition", attachmentField: "conditionBlock" };
  const candidate = [...rest, child];
  return validateBlockGraph(candidate).valid ? candidate : items;
}

/** Return the Start-connected statement chain, with socket connections hydrated for execution. */
export function getStartAttachedBlocks(items: Block[]): Block[] {
  const ordered: Block[] = [];
  const used = new Set<string>();
  let parentId = "__start";
  while (true) {
    const next = items.find(block =>
      block.attachedTo === parentId &&
      block.attachmentType !== "value" &&
      block.attachmentType !== "condition" &&
      !used.has(block.id)
    );
    if (!next) break;
    ordered.push(next);
    used.add(next.id);
    parentId = next.id;
  }
  const hydrated = new Map(hydrateBlockGraph(items).map(block => [block.id, block]));
  return ordered.map(block => hydrated.get(block.id) ?? block);
}
