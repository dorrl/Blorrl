import { GripVertical, Plus, Search } from "lucide-react";
import type { DragEvent } from "react";
import type { BlockKind } from "../language";
import { catalog } from "../editor/blockCatalog";
type BlockLibraryProps = { query: string; onQueryChange: (query: string) => void; onDragStart: (event: DragEvent<HTMLButtonElement>, kind: BlockKind) => void; onAddBlock: (kind: BlockKind) => void };
const categoryOrder = ["Output", "Variables", "Control", "Values"] as const;
export function BlockLibrary({ query, onQueryChange, onDragStart, onAddBlock }: BlockLibraryProps) {
  const visibleCatalog = catalog.filter(item => (item.label + " " + item.hint + " " + item.category).toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="library-head"><span>BLOCKS</span><span>{visibleCatalog.length.toString().padStart(2, "0")}</span></div>
    <div className="library-search"><Search size={13}/><input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Filter blocks"/></div>
    <div className="catalog-list">{categoryOrder.map(category => { const items=visibleCatalog.filter(item=>item.category===category); if(!items.length)return null; return <section className="catalog-category" key={category}><div className="catalog-category-title">{category}</div>{items.map(item=><button key={item.kind} className="catalog-item" draggable onDragStart={event=>onDragStart(event,item.kind)} onClick={()=>onAddBlock(item.kind)} title="Click to add or drag into the workspace"><span className={"catalog-icon "+item.kind}><Plus size={14}/></span><span className="catalog-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><GripVertical size={14} className="catalog-grip"/></button>)}</section>; })}</div>
  </>;
}
