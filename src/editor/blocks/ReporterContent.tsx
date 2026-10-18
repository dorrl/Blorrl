import type { ReactNode } from "react";
import type { Block } from "../../language";
type ReporterContentProps={block:Block;updateBlock:(id:string,patch:Partial<Block>)=>void};
/** Simple value reporters; Calculate and Compare have dedicated components. */
export function ReporterContent({block,updateBlock}:ReporterContentProps):ReactNode { if(block.kind==="get")return <span className="inline-get">get{" "}<input aria-label="Variable name" value={block.value} onChange={event=>updateBlock(block.id,{value:event.target.value})} onClick={event=>event.stopPropagation()}/></span>; if(block.kind==="true")return "true"; if(block.kind==="false")return "false"; return block.kind; }
