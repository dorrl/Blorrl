import { Blocks, GripVertical, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DragEvent } from "react";
import type { Block, BlockKind, ValueType } from "../language";
import { createBlock } from "../editor/blockOperations";
import { Calculate } from "../editor/blocks/Calculate";
import { Compare } from "../editor/blocks/Compare";
import { PrintBlock } from "../editor/blocks/Output";
import { VariableBlock, InputBlock } from "../editor/blocks/Variables";
import { IfConditionField, RepeatBlock, ControlBlockBody } from "../editor/blocks/Control";
import { ReporterContent, ValueSlot } from "../editor/blocks/Values";
import { catalog } from "../editor/blockCatalog";
type BlockLibraryProps = { query: string; onQueryChange: (query: string) => void; onDragStart: (event: DragEvent<HTMLElement>, kind: BlockKind) => void; onDragEnd: () => void; onAddBlock: (kind: BlockKind) => void };
const categoryOrder = ["Output", "Variables", "Control", "Values"] as const;
function categoryClass(kind: BlockKind) { return "category-" + (catalog.find(item => item.kind === kind)?.category ?? "Values").toLowerCase(); }
export function BlockLibrary({ query, onQueryChange, onDragStart, onDragEnd, onAddBlock }: BlockLibraryProps) {
  const visibleCatalog = catalog.filter(item => (item.label + " " + item.hint + " " + item.category).toLowerCase().includes(query.toLowerCase()));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const fitPreviews = () => {
      list.querySelectorAll<HTMLElement>(".catalog-item").forEach(item => {
        const preview = item.querySelector<HTMLElement>(".library-block-preview");
        if (!preview) return;
        preview.style.zoom = "1";
        const naturalWidth = preview.getBoundingClientRect().width;
        const availableWidth = Math.max(1, item.clientWidth - 16);
        const scale = naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1;
        preview.style.setProperty("--palette-preview-scale", String(scale));
        preview.style.zoom = String(scale);
      });
    };
    fitPreviews();
    const observer = new ResizeObserver(fitPreviews);
    observer.observe(list);
    return () => observer.disconnect();
  }, [visibleCatalog.length, query]);
  const updateBlock = (_id: string, _patch: Partial<Block>) => {};
  const updateType = (_id: string, _type: ValueType, _checked: boolean) => {};
  const renderValueSlot = (owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string): ReactNode => (
    <ValueSlot owner={owner} field={field} value={value} ariaLabel={ariaLabel} updateBlock={updateBlock} onDrop={() => {}} onDragStart={() => {}} renderValueSlot={renderValueSlot} />
  );
  const renderBlockBody = (block: Block): ReactNode => {
    if (block.kind === "print") return <PrintBlock block={block} renderValueSlot={renderValueSlot} />;
    if (block.kind === "let") return <VariableBlock block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} typePanelOpen={false} onToggleTypePanel={() => {}} onUpdateType={updateType} />;
    if (block.kind === "input") return <InputBlock block={block} updateBlock={updateBlock} typePanelOpen={false} onToggleTypePanel={() => {}} onUpdateType={updateType} />;
    if (block.kind === "get") return <ReporterContent block={block} updateBlock={updateBlock} />;
    if (block.kind === "add") return <Calculate block={block} renderValueSlot={renderValueSlot} updateBlock={updateBlock} />;
    if (block.kind === "compare") return <Compare block={block} renderValueSlot={renderValueSlot} updateBlock={updateBlock} />;
    if (block.kind === "if") return <IfConditionField block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} onDrop={() => {}} />;
    if (block.kind === "repeat") return <RepeatBlock block={block} renderValueSlot={renderValueSlot} />;
    return <span className="field-hint">{block.kind === "true" ? "Always true" : "Always false"}</span>;
  };
  return <>
    <div className="library-head"><span>BLOCKS</span><span>{visibleCatalog.length.toString().padStart(2, "0")}</span></div>
    <div className="library-search"><Search size={13}/><input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Filter blocks"/></div>
    <div className="catalog-list" ref={listRef}>{categoryOrder.map(category => { const items=visibleCatalog.filter(item=>item.category===category); if(!items.length)return null; return <section className="catalog-category" key={category}><div className="catalog-category-title">{category}</div>{items.map(item=>{ const block=createBlock(item.kind); return <div key={item.kind} className="catalog-item" role="button" tabIndex={0} draggable onDragStart={event=>onDragStart(event,item.kind)} onDragEnd={onDragEnd} onClick={()=>onAddBlock(item.kind)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onAddBlock(item.kind);}}} title="Click to add or drag into the workspace"><article className={"block-card library-block-preview "+categoryClass(item.kind)+" kind-"+item.kind} aria-hidden="true"><div className="block-gutter"><GripVertical size={14}/><span>+</span></div><div className="block-content"><div className="block-type"><span className={"type-icon "+categoryClass(item.kind)+" "+item.kind}><Blocks size={13}/></span><strong>{item.label}</strong><span className="block-kind">{item.kind.toUpperCase()}</span></div><div className="block-fields">{renderBlockBody(block)}</div>{(block.kind==="if"||block.kind==="repeat")&&<ControlBlockBody block={block} selected={[]} onDrop={()=>{}} onSelectBlock={()=>{}} onDragStart={()=>{}} onBlockDragEnd={()=>{}} updateBlock={updateBlock} updateBranch={()=>{}} addElseIf={()=>{}} toggleElse={()=>{}} />}</div></article></div>;})}</section>; })}</div>
  </>;
}
