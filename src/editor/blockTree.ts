import type { Block } from "../language";

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

export function removeIds(items: Block[], ids: string[]): Block[] {
    const removeOne = (block: Block): Block | null => {
      if (ids.includes(block.id)) return null;
      return {...block,conditionBlock:block.conditionBlock ? removeOne(block.conditionBlock) ?? undefined : undefined,valueBlock:block.valueBlock ? removeOne(block.valueBlock) ?? undefined : undefined,rightBlock:block.rightBlock ? removeOne(block.rightBlock) ?? undefined : undefined,children:removeIds(block.children ?? [],ids),elseIf:block.elseIf?.map(branch=>({...branch,children:removeIds(branch.children,ids)})),elseChildren:block.elseChildren?removeIds(block.elseChildren,ids):undefined};
    };
    return items.map(removeOne).filter((block): block is Block => block !== null);
  }
  export function putValue(items: Block[], targetId: string, field: "valueBlock" | "rightBlock", valueBlock: Block): Block[] {
    return items.map(b=>({...b,[field]:b.id===targetId?valueBlock:b[field],conditionBlock:b.conditionBlock?putValue([b.conditionBlock],targetId,field,valueBlock)[0]:undefined,valueBlock:b.id===targetId&&field==="valueBlock"?valueBlock:b.valueBlock?putValue([b.valueBlock],targetId,field,valueBlock)[0]:undefined,rightBlock:b.id===targetId&&field==="rightBlock"?valueBlock:b.rightBlock?putValue([b.rightBlock],targetId,field,valueBlock)[0]:undefined,children:putValue(b.children??[],targetId,field,valueBlock),elseIf:b.elseIf?.map(br=>({...br,children:putValue(br.children,targetId,field,valueBlock)})),elseChildren:b.elseChildren?putValue(b.elseChildren,targetId,field,valueBlock):undefined}));
  }

export function putCondition(items: Block[], targetId: string, conditionBlock: Block): Block[] {
    return items.map(b => ({...b, conditionBlock:b.id===targetId ? conditionBlock : b.conditionBlock ? putCondition([b.conditionBlock],targetId,conditionBlock)[0] : undefined, children:putCondition(b.children??[],targetId,conditionBlock), elseIf:b.elseIf?.map(br=>({...br,children:putCondition(br.children,targetId,conditionBlock)})), elseChildren:b.elseChildren?putCondition(b.elseChildren,targetId,conditionBlock):undefined}));
  }
