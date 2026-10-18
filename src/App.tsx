import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Play, Plus, Blocks, ChevronDown, CircleHelp, Download, RotateCcw, GripVertical, Check, Save, FolderOpen } from "lucide-react";
import { compile, compileAssembly, runProgram, type Block, type BlockKind, type ValueType } from "./language";
import { BlockLibrary } from "./components/BlockLibrary";
import { ReporterContent } from "./editor/blocks/ReporterContent";
import { PrintBlock } from "./editor/blocks/PrintBlock";
import { VariableBlock } from "./editor/blocks/VariableBlock";
import { InputBlock } from "./editor/blocks/InputBlock";
import { IfConditionField } from "./editor/blocks/IfConditionField";
import { RepeatBlock } from "./editor/blocks/RepeatBlock";
import { TerminalPanel } from "./components/TerminalPanel";
import { initialBlocks } from "./editor/initialBlocks";
import { catalog } from "./editor/blockCatalog";
import { allBlocks, putCondition, putValue, removeIds } from "./editor/blockTree";
import { useCanvasPan } from "./editor/useCanvasPan";

type DragPayload = { source: "canvas"; ids: string[] } | { source: "library"; kind: BlockKind };
type BlockPointerDrag = { pointerId: number; startX: number; startY: number; ids: string[]; origins: Record<string, { x: number; y: number }> };
type SnapGhost = { x: number; y: number; count: number; targetId: string };

export default function App() {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState("Ready. Run your program to see output here.");
  const [status, setStatus] = useState<"idle" | "built" | "ran" | "error">("idle");
  const [selected, setSelected] = useState<string[]>(["b1"]);
  const [showHelp, setShowHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [positions, setPositions] = useState<Record<string,{x:number;y:number}>>({});
  const [workspaceRatio, setWorkspaceRatio] = useState(68);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [spaceDown, setSpaceDown] = useState(false);
  const [typePanelFor, setTypePanelFor] = useState<string | null>(null);
  const dragOrigin = useRef<{x:number;y:number;ids:string[];origins:Record<string,{x:number;y:number}>}|null>(null); 
  const blockPointerDrag = useRef<BlockPointerDrag | null>(null);
  const blockDragMoved = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ids:string[];dx:number;dy:number}|null>(null);
  const [dragCanvasExtent, setDragCanvasExtent] = useState(0);
  const [snapGhost, setSnapGhost] = useState<SnapGhost | null>(null);
  const snapGhostRef = useRef<SnapGhost | null>(null);
  snapGhostRef.current = snapGhost;
  const resizeOrigin = useRef<{y:number;ratio:number}|null>(null);
  const sidebarResizeOrigin = useRef<{x:number;width:number}|null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const canvasRef = useRef<HTMLDivElement>(null);
  const { startCanvasGesture, moveCanvasGesture, endCanvasGesture } = useCanvasPan(canvasRef, spaceDown);
  const compiled = useMemo(() => compile(blocks), [blocks]);
  const assemblyCompiled = useMemo(() => compileAssembly(blocks), [blocks]);
  const totalBlocks = allBlocks(blocks).length;

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { setSpaceDown(true); event.preventDefault(); }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setBlocks(current=>removeIds(current,selected));setSelected([]);setStatus("idle");
      }
    };
    const up = (event: globalThis.KeyboardEvent) => {if(event.code==="Space")setSpaceDown(false);};
    const blur = () => setSpaceDown(false);
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",blur);
    return ()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",blur);};
  }, [selected]);

  useEffect(() => {
    const handleResizeMove = (event: PointerEvent) => {
      const origin = resizeOrigin.current;
      if (origin) {
        setWorkspaceRatio(Math.max(30, Math.min(85, origin.ratio + (event.clientY - origin.y) / Math.max(1, window.innerHeight) * 100)));
      }
      const sidebarOrigin = sidebarResizeOrigin.current;
      if (sidebarOrigin) {
        setSidebarWidth(Math.max(150, Math.min(Math.min(420, window.innerWidth * 0.42), sidebarOrigin.width + event.clientX - sidebarOrigin.x)));
      }
    };
    const handleResizeEnd = () => {
      resizeOrigin.current = null;
      sidebarResizeOrigin.current = null;
      document.body.classList.remove("resizing-pane", "resizing-sidebar");
    };
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", handleResizeEnd);
    window.addEventListener("pointercancel", handleResizeEnd);
    return () => {
      window.removeEventListener("pointermove", handleResizeMove);
      window.removeEventListener("pointerup", handleResizeEnd);
      window.removeEventListener("pointercancel", handleResizeEnd);
    };
  }, []);


  useEffect(() => {
    let active = true;
    fetch("/server/api/health").then(r => { if (!r.ok) throw new Error("offline"); return r.json(); })
      .then(() => { if (active) setServerOnline(true); })
      .catch(() => { if (active) setServerOnline(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handleBlockPointerMove = (event: PointerEvent) => {
      const drag = blockPointerDrag.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas || event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 3) blockDragMoved.current = true;
      setDragPreview({ids:drag.ids,dx,dy});

      const movingElement = drag.ids.length ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${drag.ids[0]}"]`) : null;
      const movingOrigin = drag.origins[drag.ids[0] ?? ""];
      const canvasRect = canvas.getBoundingClientRect();
      // Snap when the dragged stack's top edge reaches the target's bottom edge,
      // independent of where inside the dragged block the pointer was grabbed.
      const movingTop = canvasRect.top + (movingOrigin?.y ?? movingElement?.offsetTop ?? 0) + dy - canvas.scrollTop;
      const movingLeft = canvasRect.left + (movingOrigin?.x ?? movingElement?.offsetLeft ?? 0) + dx - canvas.scrollLeft;
      const movingRight = movingLeft + (movingElement?.offsetWidth ?? 0);
      const isLooseReporterDrag = drag.ids.length === 1 && !!movingElement && ["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind => movingElement.classList.contains(kind));
      const candidate = isLooseReporterDrag ? undefined : Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]"))
        .filter(element => !drag.ids.includes(element.dataset.blockId ?? "") && !["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind=>element.classList.contains(kind)))
        .map(element => {
          const rect = element.getBoundingClientRect();
          const id = element.dataset.blockId;
          return id ? {
            id,
            x: element.offsetLeft,
            y: element.offsetTop + element.offsetHeight - 1,
            distance: Math.abs(movingTop - rect.bottom),
            horizontal: movingRight >= rect.left - 14 && movingLeft <= rect.right + 14
          } : null;
        })
        .filter((item): item is { id: string; x: number; y: number; distance: number; horizontal: boolean } => item !== null && item.distance < 18 && item.horizontal)
        .sort((a, b) => a.distance - b.distance)[0];

      const startNode = canvas.querySelector<HTMLElement>(".start-node");
      const startRect = startNode?.getBoundingClientRect();
      const startCandidate = !isLooseReporterDrag && startNode && startRect ? {
        id: "__start",
        x: startNode.offsetLeft,
        y: startNode.offsetTop + startNode.offsetHeight - 1,
        distance: Math.abs(movingTop - startRect.bottom),
        horizontal: movingRight >= startRect.left - 14 && movingLeft <= startRect.right + 14
      } : null;
      const movingElementForSocket = drag.ids.length === 1 ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${drag.ids[0]}"]`) : null;
      const canBeCondition = !!movingElementForSocket && ["kind-true","kind-false","kind-compare"].some(kind => movingElementForSocket.classList.contains(kind));
      const canBeValue = !!movingElementForSocket && ["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind=>movingElementForSocket.classList.contains(kind));
      const valueCandidate = canBeValue ? Array.from(canvas.querySelectorAll<HTMLElement>(".value-slot[data-value-for][data-value-field]"))
        .map(slot=>{const rect=slot.getBoundingClientRect();const inside=event.clientX>=rect.left-4&&event.clientX<=rect.right+4&&event.clientY>=rect.top-4&&event.clientY<=rect.bottom+4;return inside?{id:"__value__:"+slot.dataset.valueFor+":"+slot.dataset.valueField,x:rect.left-canvasRect.left+canvas.scrollLeft,y:rect.top-canvasRect.top+canvas.scrollTop,distance:0,horizontal:true,area:rect.width*rect.height}:null;}).filter((item):item is {id:string;x:number;y:number;distance:number;horizontal:boolean;area:number}=>item!==null).sort((a,b)=>a.area-b.area)[0]??null:null;
      const conditionCandidate = canBeCondition ? Array.from(canvas.querySelectorAll<HTMLElement>(".condition-slot[data-condition-for]"))
        .map(slot => {
          const rect = slot.getBoundingClientRect();
          const inside = event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
          return inside ? {id:"__condition__:"+slot.dataset.conditionFor, x:rect.left-canvasRect.left+canvas.scrollLeft, y:rect.top-canvasRect.top+canvas.scrollTop, distance:0, horizontal:true} : null;
        }).find(item => item !== null) ?? null : null;
      const snap = valueCandidate ?? conditionCandidate ?? (startCandidate && startCandidate.distance < 18 && startCandidate.horizontal && (!candidate || startCandidate.distance < candidate.distance)
        ? startCandidate
        : candidate);
      const ghost = snap ? { x: snap.x, y: snap.y, count: drag.ids.length, targetId: snap.id } : null;
      snapGhostRef.current = ghost;
      setSnapGhost(ghost);
      if (Math.hypot(dx, dy) > 3) event.preventDefault();
    };

    const handleBlockPointerUp = (event: PointerEvent) => {
      const drag = blockPointerDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      blockPointerDrag.current = null;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const ghost = snapGhostRef.current;
      const canvas = canvasRef.current;
      const next: Record<string, {x:number;y:number}> = {...positionsRef.current};

      if (ghost?.targetId.startsWith("__value__:")) {
        const [,targetId,field] = ghost.targetId.split(":");
        setBlocks(current => {
          const child = allBlocks(current).find(block => drag.ids.includes(block.id));
          if (!child || !["add","compare","true","false","get"].includes(child.kind) || !targetId || (field !== "valueBlock" && field !== "rightBlock")) return current;
          return putValue(removeIds(current,drag.ids),targetId,field,child);
        });
        drag.ids.forEach(id => delete next[id]);
        setSelected(drag.ids.slice(0,1));
      } else if (ghost?.targetId.startsWith("__condition__:")) {
        const targetId = ghost.targetId.slice("__condition__:".length);
        setBlocks(current => {
          const child = allBlocks(current).find(block => drag.ids.includes(block.id));
          if (!child || (child.kind !== "true" && child.kind !== "false" && child.kind !== "compare")) return current;
          return putCondition(removeIds(current,drag.ids),targetId,child);
        });
        drag.ids.forEach(id => delete next[id]);
        setSelected(drag.ids.slice(0,1));
      } else if (ghost) {
        const movingHeight = drag.ids.reduce((sum,id) => sum + (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1, 0);
        setBlocks(current => {
          const moving = current.filter(block => drag.ids.includes(block.id));
          const rest = current.filter(block => !drag.ids.includes(block.id));
          const targetIndex = ghost.targetId === "__start" ? -1 : rest.findIndex(block => block.id === ghost.targetId);
          rest.splice(ghost.targetId === "__start" ? 0 : targetIndex < 0 ? rest.length : targetIndex + 1, 0, ...moving);
          return rest;
        });
        Object.entries(next).forEach(([id,point]) => {
          if (!drag.ids.includes(id) && point.y >= ghost.y) next[id] = {x:point.x,y:point.y+movingHeight};
        });
        let y = ghost.y;
        drag.ids.forEach(id => {
          next[id] = {x:ghost.x,y};
          y += (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1;
        });
      } else {
        drag.ids.forEach(id => {
          const origin = drag.origins[id];
          if (origin) next[id] = {x:Math.max(12,origin.x+dx),y:Math.max(64,origin.y+dy)};
        });
      }

      setPositions(next);
      setDragPreview(null);
      setDragCanvasExtent(0);
      if (ghost) setStatus("idle");
      snapGhostRef.current = null;
      setSnapGhost(null);
    };

    window.addEventListener("pointermove", handleBlockPointerMove);
    window.addEventListener("pointerup", handleBlockPointerUp);
    window.addEventListener("pointercancel", handleBlockPointerUp);
    return () => {
      window.removeEventListener("pointermove", handleBlockPointerMove);
      window.removeEventListener("pointerup", handleBlockPointerUp);
      window.removeEventListener("pointercancel", handleBlockPointerUp);
    };
  }, []);


  function updateBlock(id: string, patch: Partial<Block>) {
    const update = (items: Block[]): Block[] => items.map(block => block.id === id ? {...block,...patch} : ({
      ...block, conditionBlock:block.conditionBlock ? update([block.conditionBlock])[0] : undefined, valueBlock:block.valueBlock ? update([block.valueBlock])[0] : undefined, rightBlock:block.rightBlock ? update([block.rightBlock])[0] : undefined, children:update(block.children ?? []),
      elseIf:block.elseIf?.map(branch=>({...branch,children:update(branch.children)})),
      elseChildren:block.elseChildren ? update(block.elseChildren) : undefined,
    }));
    setBlocks(update); setStatus("idle");
  }
  function makeBlock(kind: BlockKind): Block {
    const block: Block = {id:crypto.randomUUID(),kind,value:kind==="print" ? "Hello!" : kind==="get" ? "value" : kind==="true" ? "true" : kind==="false" ? "false" : "1"};
    if (kind==="let" || kind==="input") {block.name="value";block.types=["number"];}
    if (kind==="add") {block.right="1";block.operator="+";}
    if (kind==="compare") {block.right="0";block.comparisonOperator="==";}
    if (kind==="if") {block.children=[];block.conditionBlock={id:crypto.randomUUID(),kind:"false",value:"false"};}
    if (kind==="repeat") block.children=[];
    return block;
  }
  function addBlock(kind: BlockKind, beforeId?: string, dropPoint?: {x:number;y:number}) {
    const block = makeBlock(kind);
    const rect = canvasRef.current?.getBoundingClientRect();
    const targetIndex = beforeId ? blocks.findIndex(item => item.id === beforeId) : -1;
    const targetPosition = beforeId ? positions[beforeId] ?? {x:42,y:90 + Math.max(0,targetIndex)*86} : undefined;
    const insertY = targetPosition?.y ?? dropPoint?.y ?? 90 + blocks.length*95;
    const blockHeight = kind === "if" || kind === "repeat" ? 90 : kind === "compare" ? 42 : kind === "add" || kind === "true" || kind === "false" || kind === "get" ? 38 : 42;
    setPositions(current => {
      const next = {...current,[block.id]:beforeId && targetPosition ? {x:targetPosition.x,y:insertY} : dropPoint ?? {x:42 + Math.max(0,(rect?.width ?? 700)*0.06),y:insertY}};
      if (beforeId && targetPosition) Object.entries(current).forEach(([id,point]) => {
        if (id !== block.id && point.y >= insertY) next[id] = {x:point.x,y:point.y+blockHeight-8};
      });
      return next;
    });
    setBlocks(current => {
      if (!beforeId) return [...current, block];
      const index = current.findIndex(item => item.id === beforeId);
      return index < 0 ? [...current, block] : [...current.slice(0, index), block, ...current.slice(index)];
    });
    setSelected([block.id]); setStatus("idle");
  }

  function detachValueBlock(ownerId: string, field: "valueBlock" | "rightBlock") {
    const canvas = canvasRef.current;
    const ownerElement = canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${ownerId}"]`);
    const canvasRect = canvas?.getBoundingClientRect();
    const ownerRect = ownerElement?.getBoundingClientRect();
    const point = canvas && canvasRect && ownerRect ? {
      x: Math.max(12, ownerRect.left - canvasRect.left + canvas.scrollLeft + 24),
      y: Math.max(64, ownerRect.top - canvasRect.top + canvas.scrollTop + 44),
    } : {x:42,y:104};
    setBlocks(current => {
      const owner = allBlocks(current).find(block => block.id === ownerId);
      const nested = owner?.[field];
      if (!nested) return current;
      const clearSlot = (items: Block[]): Block[] => items.map(block => ({
        ...block,
        ...(block.id === ownerId ? (field === "valueBlock" ? {valueBlock:undefined} : {rightBlock:undefined}) : {}),
        conditionBlock:block.conditionBlock ? clearSlot([block.conditionBlock])[0] : undefined,
        valueBlock:block.id === ownerId && field === "valueBlock" ? undefined : block.valueBlock ? clearSlot([block.valueBlock])[0] : undefined,
        rightBlock:block.id === ownerId && field === "rightBlock" ? undefined : block.rightBlock ? clearSlot([block.rightBlock])[0] : undefined,
        children:clearSlot(block.children ?? []),
        elseIf:block.elseIf?.map(branch=>({...branch,children:clearSlot(branch.children)})),
        elseChildren:block.elseChildren ? clearSlot(block.elseChildren) : undefined,
      }));
      return [...clearSlot(current), nested];
    });
    setPositions(current => ({...current,[allBlocks(blocks).find(block => block.id === ownerId)?.[field]?.id ?? ""]:point}));
    setSelected([allBlocks(blocks).find(block => block.id === ownerId)?.[field]?.id ?? ownerId]);
    setStatus("idle");
  }

  function renderValueSlot(owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) {
    const nested = field === "valueBlock" ? owner.valueBlock : owner.rightBlock;
    return <div className="value-slot" data-value-for={owner.id} data-value-field={field} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("value-hover"); }} onDragLeave={e => e.currentTarget.classList.remove("value-hover")} onDrop={e => { e.currentTarget.classList.remove("value-hover"); onDrop(e, `value:${owner.id}:${field}`); }}>
      {nested ? <><span className={"value-chip kind-" + nested.kind} draggable onDragStart={e => onDragStart(e, {source:"canvas",ids:[nested.id]})}><ReporterContent block={nested} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /></span><button className="value-eject" title="Move block to canvas" aria-label="Move nested value to canvas" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); detachValueBlock(owner.id, field); }}>↗</button><button className="value-remove" aria-label="Remove nested value" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); updateBlock(owner.id, field === "valueBlock" ? {valueBlock:undefined} : {rightBlock:undefined}); }}>×</button></> : <input className="value-input" aria-label={ariaLabel} value={value} onChange={e => updateBlock(owner.id, field === "valueBlock" ? {value:e.target.value} : {right:e.target.value})} onClick={e => e.stopPropagation()} />}
    </div>;
  }
  function dropCondition(targetId: string, child: Block, movingIds: string[] = []) {
    if (child.kind !== "true" && child.kind !== "false" && child.kind !== "compare") return;
    setBlocks(current => {
      const source = allBlocks(current).find(b => b.id === child.id) ?? child;
      const rest = movingIds.length ? removeIds(current,movingIds) : current;
      return putCondition(rest,targetId,source);
    });
    setSelected([child.id]); setStatus("idle");
  }
  function insertNested(targetId: string, child: Block) {
    const insert = (items: Block[]): Block[] => items.map(b => {
      if (b.id === targetId && (b.kind === "if" || b.kind === "repeat")) return {...b,children:[...(b.children??[]),child]};
      const elseIf = (b.elseIf??[]).map(br => br.id===targetId ? {...br,children:[...br.children,child]} : {...br,children:insert(br.children)});
      const elseChildren = b.elseId===targetId ? [...(b.elseChildren??[]),child] : b.elseChildren ? insert(b.elseChildren) : undefined;
      return {...b,children:insert(b.children??[]),elseIf:b.elseIf?elseIf:undefined,elseChildren};
    });
    setBlocks(insert);setSelected([child.id]);setStatus("idle");
  }
  function nestBlocks(targetId: string, ids: string[]) {
    if (ids.includes(targetId)) return;
    setBlocks(current => {
      const moving=allBlocks(current).filter(b=>ids.includes(b.id));
      const rest=removeIds(current,ids);
      const insert=(items:Block[]):Block[]=>items.map(b=>{
        if(b.id===targetId&&(b.kind==="if"||b.kind==="repeat"))return {...b,children:[...(b.children??[]),...moving]};
        const branches=(b.elseIf??[]).map(br=>br.id===targetId?{...br,children:[...br.children,...moving]}:{...br,children:insert(br.children)});
        const els=b.elseId===targetId?[...(b.elseChildren??[]),...moving]:b.elseChildren?insert(b.elseChildren):undefined;
        return {...b,children:insert(b.children??[]),elseIf:b.elseIf?branches:undefined,elseChildren:els};
      });
      return insert(rest);
    });
    setPositions(current=>{const next={...current};ids.forEach(id=>delete next[id]);return next;});setStatus("idle");
  }
  function updateType(id: string, type: ValueType, checked: boolean) {
    const block = allBlocks(blocks).find(b => b.id === id);
    if (!block) return;
    const types = block.types ?? ["number"];
    updateBlock(id, {types: checked ? [...new Set([...types, type])] : types.filter(t => t !== type)});
  }
  function addElseIf(id: string) {
    const update = (items: Block[]): Block[] => items.map(block => ({
      ...block,
      children: update(block.children ?? []),
      elseIf: block.id === id
        ? [...(block.elseIf ?? []).map(branch => ({ ...branch, children: update(branch.children) })), { id: crypto.randomUUID(), condition: "false", children: [] }]
        : block.elseIf?.map(branch => ({ ...branch, children: update(branch.children) })),
      elseChildren: block.elseChildren ? update(block.elseChildren) : undefined,
      conditionBlock: block.conditionBlock ? update([block.conditionBlock])[0] : undefined,
      valueBlock: block.valueBlock ? update([block.valueBlock])[0] : undefined,
      rightBlock: block.rightBlock ? update([block.rightBlock])[0] : undefined,
    }));
    setBlocks(update);
    setStatus("idle");
  }
  function toggleElse(id: string) {
    const block = allBlocks(blocks).find(b=>b.id===id);
    updateBlock(id,{elseChildren:block?.elseChildren ? undefined : [],elseId:block?.elseChildren ? undefined : crypto.randomUUID()});
  }
  function updateBranch(branchId: string, condition: string) {
    const update = (items: Block[]): Block[] => items.map(b=>({...b,elseIf:b.elseIf?.map(br=>br.id===branchId?{...br,condition:condition}: {...br,children:update(br.children)}),children:update(b.children??[]),elseChildren:b.elseChildren?update(b.elseChildren):undefined}));
    setBlocks(update); setStatus("idle");
  }
  function moveSelection(ids: string[], targetId?: string) {
    setBlocks(current => {
      const moving = current.filter(block => ids.includes(block.id));
      if (!moving.length) return current;
      const rest = current.filter(block => !ids.includes(block.id));
      const targetIndex = targetId ? rest.findIndex(block => block.id === targetId) : -1;
      rest.splice(targetIndex < 0 ? rest.length : targetIndex, 0, ...moving);
      return rest;
    });
    setStatus("idle");
  }
  function onDragStart(event: DragEvent, payload: DragPayload) {
    if (spaceDown || (payload.source === "canvas" && (event.target as HTMLElement).closest("input,button"))) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-blorrl", JSON.stringify(payload));
    if (payload.source === "canvas") {
      const nestedReporter = !!(event.target as HTMLElement).closest(".value-chip");
      const ids = !nestedReporter && selected.includes(payload.ids[0]) ? selected : payload.ids;
      const origins: Record<string,{x:number;y:number}> = {};
      ids.forEach(id => { origins[id] = positionsRef.current[id] ?? {x:42,y:104 + blocks.findIndex(b=>b.id===id)*104}; });
      dragOrigin.current = {x:event.clientX,y:event.clientY,ids,origins};
    }
  }
  function onBlockDragEnd(event: DragEvent) {
    const drag = dragOrigin.current;
    if (!drag) return;
    dragOrigin.current = null;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const next: Record<string,{x:number;y:number}> = {...positionsRef.current};
    drag.ids.forEach(item => { const p=drag.origins[item]; next[item]={x:Math.max(12,p.x+dx),y:Math.max(64,p.y+dy)}; });
    const canvas = canvasRef.current;
    const target = canvas ? Array.from(canvas.querySelectorAll<HTMLElement>("[data-block-id]")).filter(el => !drag.ids.includes(el.dataset.blockId ?? "")).map(el => {
      const targetId=el.dataset.blockId!; const p=next[targetId] ?? {x:42,y:104}; const r=el.getBoundingClientRect();
      return {id:targetId,p,dist:Math.hypot(event.clientX-(r.left+r.width/2),event.clientY-r.bottom)};
    }).filter(item=>item.dist<70).sort((a,b)=>a.dist-b.dist)[0] : undefined;
    const startNode = canvas?.querySelector<HTMLElement>(".start-node");
    const startRect = startNode?.getBoundingClientRect();
    const startTarget = startRect ? {id:"__start",p:{x:startNode!.offsetLeft,y:startNode!.offsetTop},dist:Math.hypot(event.clientX-(startRect.left+startRect.width/2),event.clientY-startRect.bottom)} : undefined;
    const snapToStart = startTarget && startTarget.dist < 70 && (!target || startTarget.dist < target.dist);
    const snapped = snapToStart ? startTarget : target;
    if (snapped) {
      setBlocks(current => {
        const moving=current.filter(b=>drag.ids.includes(b.id));
        const rest=current.filter(b=>!drag.ids.includes(b.id));
        const i=snapped.id==="__start" ? -1 : rest.findIndex(b=>b.id===snapped.id);
        rest.splice(snapped.id==="__start" ? 0 : i<0 ? rest.length : i+1,0,...moving);
        return rest;
      });
      const targetEl = snapped.id==="__start" ? startNode : canvas?.querySelector<HTMLElement>(`[data-block-id="${snapped.id}"]`);
      let y = snapped.p.y + (targetEl?.offsetHeight ?? 50) - 1;
      drag.ids.forEach(item => { next[item]={x:snapped.p.x,y}; y += (canvas?.querySelector<HTMLElement>(`[data-block-id="${item}"]`)?.offsetHeight ?? 92)-1; });
    }
    setPositions(next);
    setStatus("idle");
  }
  function onDrop(event: DragEvent, targetId?: string) {
    event.preventDefault(); event.stopPropagation();
    const raw=event.dataTransfer.getData("application/x-blorrl"); if(!raw)return;
    try {
      const payload=JSON.parse(raw) as DragPayload;
      const valueTarget = targetId?.startsWith("value:") ? targetId.slice("value:".length).split(":") : undefined;
      if (valueTarget && valueTarget.length===2) {
        const [ownerId,field]=valueTarget;
        const child=payload.source==="library"?makeBlock(payload.kind):allBlocks(blocks).find(b=>payload.ids.includes(b.id));
        if(child&&ownerId&&(field==="valueBlock"||field==="rightBlock")&&["add","compare","true","false","get"].includes(child.kind)) setBlocks(current=>putValue(payload.source==="library"?current:removeIds(current,payload.ids),ownerId,field,child));
        return;
      }
      const conditionTarget = targetId?.startsWith("condition:") ? targetId.slice("condition:".length) : undefined;
      if (conditionTarget) {
        if (payload.source === "library") dropCondition(conditionTarget,makeBlock(payload.kind));
        else {
          const child = allBlocks(blocks).find(b=>payload.ids.includes(b.id));
          if (child) dropCondition(conditionTarget,child,payload.ids);
        }
        return;
      }
      const reporterKinds = ["add","compare","true","false","get"];
      const movingKinds = payload.source === "library" ? [payload.kind] : allBlocks(blocks).filter(b=>payload.ids.includes(b.id)).map(b=>b.kind);
      const isReporter = movingKinds.some(kind=>reporterKinds.includes(kind));
      const target=targetId ? allBlocks(blocks).find(b=>b.id===targetId) : undefined;
      const branchTarget=!!targetId && allBlocks(blocks).some(b=>b.elseId===targetId||(b.elseIf??[]).some(br=>br.id===targetId));
      if (targetId && ((target && (target.kind==="if" || target.kind==="repeat")) || branchTarget)) {
        if(payload.source==="library") insertNested(targetId,makeBlock(payload.kind));
        else nestBlocks(targetId,payload.ids);
      } else {
        const rect=canvasRef.current?.getBoundingClientRect();
        const point=rect&&canvasRef.current?{x:Math.max(12,event.clientX-rect.left+canvasRef.current.scrollLeft-150),y:Math.max(64,event.clientY-rect.top+canvasRef.current.scrollTop-24)}:undefined;
        if (payload.source === "library") {
          addBlock(payload.kind, targetId, point);
        } else if (isReporter) {
          const child = allBlocks(blocks).find(b=>payload.ids.includes(b.id));
          if (child && point) {
            setBlocks(current=>[...removeIds(current,payload.ids),child]);
            setPositions(current=>({...current,[child.id]:point}));
            setSelected([child.id]);
          }
        } else moveSelection(payload.ids,targetId);
      }
    } catch { /* Ignore invalid drag payloads. */ }
  }
  function selectBlock(_event: MouseEvent, id: string) {
    setSelected([id]);
  }
  function run() {
    setBusy(true);
    try {
      const result = runProgram(compiled, stdin, blocks);
      setOutput(result.error || result.output || "(no output)");
      setStatus(result.error ? "error" : "ran");
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); setStatus("error"); }
    finally { setBusy(false); }
  }
  async function downloadBuild(target: "assembly" | "exe") {
    setBusy(true);
    try {
      if (assemblyCompiled.errors.length) throw new Error(assemblyCompiled.errors.join("\n"));
      const response = await fetch("/server/api/build/" + target, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:assemblyCompiled.code})});
      if (!response.ok) throw new Error(await response.text());
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=target==="exe"?"main.exe":"main.s";a.click();URL.revokeObjectURL(url);
      setOutput(target==="exe"?"Windows executable downloaded.":"Windows x64 assembly downloaded.");setStatus("built");
    } catch(error) {setOutput(error instanceof Error?error.message:String(error));setStatus("error");}
    finally {setBusy(false);}
  }

  function saveProject() {
    const project = { format: "blorrl", version: 1, workspace: { blocks, positions, workspaceRatio, sidebarWidth } };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "blorrl-project.blorrl"; a.click();
    URL.revokeObjectURL(url);
    setOutput("Blorrl project saved."); setStatus("built");
  }

  async function loadProject(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (project?.format !== "blorrl" || project.version !== 1 || !project.workspace || !Array.isArray(project.workspace.blocks)) throw new Error("Unsupported or invalid Blorrl project format.");
      if (!project.workspace.blocks.every((b: unknown) => !!b && typeof b === "object" && typeof (b as Block).id === "string" && typeof (b as Block).kind === "string")) throw new Error("Project contains an invalid block.");
      const loadedPositions: Record<string, {x:number;y:number}> = {};
      if (project.workspace.positions && typeof project.workspace.positions === "object") {
        for (const [id, p] of Object.entries(project.workspace.positions as Record<string, {x:number;y:number}>)) {
          if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) loadedPositions[id] = {x:p.x,y:p.y};
        }
      }
      setBlocks(project.workspace.blocks as Block[]); setPositions(loadedPositions);
      setSelected(project.workspace.blocks[0] ? [project.workspace.blocks[0].id] : []);
      if (Number.isFinite(project.workspace.workspaceRatio)) setWorkspaceRatio(Math.max(30, Math.min(85, project.workspace.workspaceRatio)));
      if (Number.isFinite(project.workspace.sidebarWidth)) setSidebarWidth(Math.max(150, Math.min(420, project.workspace.sidebarWidth)));
      setTypePanelFor(null); setSnapGhost(null); snapGhostRef.current = null;
      setOutput("Loaded " + file.name); setStatus("idle");
    } catch (error) { setOutput(error instanceof Error ? error.message : "Could not open project file."); setStatus("error"); }
  }

  return <main className="studio">
    <header className="topbar">
      <input type="file" accept=".blorrl,application/json" hidden onChange={loadProject}/>
      <a className="brand" href="#"><span className="brand-mark"><Blocks size={18}/></span><span>blorrl<span className="brand-dot">.</span></span><span className="studio-tag">STUDIO</span></a>
      <div className="top-meta"><span className="live-dot"/><span>WORKSPACE</span><span className="version">develop / main.blorr</span></div>
      <div className="top-actions"><span className={"server-indicator " + (serverOnline === true ? "online" : serverOnline === false ? "offline" : "")}><span/>{serverOnline === true ? "SERVER CONNECTED" : serverOnline === false ? "SERVER OFFLINE" : "CONNECTING"}</span><button className="icon-button" title="Language guide" onClick={() => setShowHelp(v => !v)}><CircleHelp size={16}/></button><button className="subtle-button" onClick={() => {setBlocks(initialBlocks);setSelected(["b1"]);setStatus("idle");}}><RotateCcw size={13}/> Reset</button><button className="build-button" onClick={() => document.querySelector<HTMLInputElement>('.topbar input[type="file"]')?.click()}><FolderOpen size={13}/> Open</button><button className="build-button" onClick={saveProject}><Save size={13}/> Save .blorrl</button><button className="build-button" disabled={busy} onClick={() => downloadBuild("assembly")}><Download size={13}/> .s</button><button className="build-button" disabled={busy} onClick={() => downloadBuild("exe")}><Download size={13}/> .exe</button><button className="run-button" disabled={busy} onClick={run}><Play size={14} fill="currentColor"/> Run</button></div>
    </header>
    <section className="workspace" style={{height: `calc(${workspaceRatio}vh - ${76 * workspaceRatio / 100}px)`}}>
      <aside className="sidebar" style={{width:sidebarWidth,flexBasis:sidebarWidth}}>
        <div className="side-title"><span>EXPLORER</span><span className="side-menu">···</span></div>
        <div className="project-row"><ChevronDown size={13}/><span className="folder-glyph">▣</span><strong>BLORRL PROJECT</strong></div>
        <div className="file-row"><span className="file-glyph">B</span><span>main.blorr</span><span className="file-unsaved"/></div>
        <BlockLibrary query={query} onQueryChange={setQuery} onDragStart={(event,kind)=>onDragStart(event,{source:"library",kind})} onAddBlock={addBlock} />
      </aside>
      <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" title="Drag to resize sidebar" onPointerDown={e=>{e.preventDefault();sidebarResizeOrigin.current={x:e.clientX,width:sidebarWidth};document.body.classList.add("resizing-sidebar");}}><span/></div>
      <section className="editor">
        <div className="tabbar"><div className="editor-tab"><span className="tab-file-icon">B</span>main.blorr<span className="tab-unsaved"/></div><div className="tabbar-spacer"/><span className="tab-language">BLORRL</span></div>
        <div className="breadcrumb"><span>main.blorr</span><span>›</span><span>main</span><span className="breadcrumb-right">{totalBlocks} blocks</span></div>
        <div className="pane-heading"><div><span className="pane-eyebrow">VISUAL EDITOR</span><h1>Program flow</h1></div><div className="pane-tools"><span className="saved-indicator"><span/> All changes local</span></div></div>
        {showHelp && <div className="help-panel"><strong>Quick language guide</strong><p>Space + drag pans the canvas. Drag blocks to move them. Only one block can be selected at a time. Statement blocks snap into stacks; Calculate, ==, and variable getter blocks go into value sockets. Dragging a statement block carries the blocks connected below it. Delete/Backspace removes selected blocks.</p><code>print "hello";</code></div>}
        <div className={"block-canvas " + (spaceDown ? "space-pan " : "") + (dragPreview ? "dragging-block" : "")} ref={canvasRef} onPointerDown={startCanvasGesture} onPointerMove={moveCanvasGesture} onPointerUp={endCanvasGesture} onPointerCancel={endCanvasGesture} onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e)}>
          <div className="canvas-ruler"><span>PROGRAM ENTRY</span><span>{spaceDown ? "SPACE + DRAG TO PAN" : "DRAG BLOCKS TO MOVE"}</span></div>
          <div className="start-node" style={{left:42,top:38}}><span className="start-play"><Play size={13} fill="currentColor"/></span><div><strong>Start</strong><small>Program entry point · fixed</small></div><span className="fixed-pill"><Check size={10}/> FIXED</span></div>
          <div className="flow-stem"><span/></div>
          {dragPreview && dragCanvasExtent > 0 && <div aria-hidden="true" className="drag-extent-preserver" style={{top:dragCanvasExtent-1}} />}
          {blocks.length === 0 && <div className="empty-state"><Blocks size={26}/><strong>Drop a block to begin</strong><span>Drag from the Explorer or click a block on the left.</span></div>}
          {blocks.map((block,index) => <article key={block.id} data-block-id={block.id} data-drop-into={block.kind === "if" || block.kind === "repeat" ? block.id : undefined} style={{left:positions[block.id]?.x ?? 42,top:positions[block.id]?.y ?? (90 + index*86),zIndex:typePanelFor===block.id?30:selected.includes(block.id)?4:2,transform:dragPreview && dragPreview.ids.includes(block.id)?`translate(${dragPreview.dx}px, ${dragPreview.dy}px)`:undefined,touchAction:"none"}} className={"block-card kind-" + block.kind + (selected.includes(block.id) ? " selected" : "")} onClickCapture={e => { const target = e.target as HTMLElement; if (target instanceof HTMLInputElement && !blockDragMoved.current) target.focus(); }} onPointerDown={e => {
            if (spaceDown || e.button !== 0 || (e.target as HTMLElement).closest("input,button,select,textarea")) return;
            e.preventDefault();
            e.stopPropagation();
            const selectedIds = [block.id];
            const blockIndex = blocks.findIndex(item => item.id === block.id);
            const reporter = ["add","compare","true","false","get"].includes(block.kind);
            // Only carry the contiguous stack physically attached below this block.
            // A block later in the program list is not automatically part of this stack.
            const connectedStack = (startIndex: number) => {
              const stackIds = [blocks[startIndex]!.id];
              let previous = canvasRef.current?.querySelector<HTMLElement>(`.block-card[data-block-id="${blocks[startIndex]!.id}"]`);
              for (let index = startIndex + 1; index < blocks.length; index++) {
                const nextBlock = blocks[index]!;
                if (["add","compare","true","false","get"].includes(nextBlock.kind)) break;
                const nextElement = canvasRef.current?.querySelector<HTMLElement>(`.block-card[data-block-id="${nextBlock.id}"]`);
                if (!previous || !nextElement) break;
                const previousRect = previous.getBoundingClientRect();
                const nextRect = nextElement.getBoundingClientRect();
                if (Math.abs(nextRect.left - previousRect.left) > 12 || Math.abs(nextRect.top - (previousRect.bottom - 1)) > 12) break;
                stackIds.push(nextBlock.id);
                previous = nextElement;
              }
              return stackIds;
            };
            const ids = reporter ? [block.id] : connectedStack(blockIndex);
            if (!selected.includes(block.id)) setSelected(selectedIds);
            const origins: Record<string,{x:number;y:number}> = {};
            ids.forEach(id => { origins[id] = positionsRef.current[id] ?? {x:42,y:90 + blocks.findIndex(item=>item.id===id)*86}; });
            setDragCanvasExtent(canvasRef.current?.scrollHeight ?? 0);
            blockPointerDrag.current = {pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,ids,origins};
            snapGhostRef.current = null;
            setSnapGhost(null);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }} onClick={e => selectBlock(e,block.id)} onDragOver={e => {e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("drop-target");}} onDragLeave={e => e.currentTarget.classList.remove("drop-target")} onDrop={e => {e.currentTarget.classList.remove("drop-target");onDrop(e,block.id);}}>
              <div className="block-gutter"><GripVertical size={14}/><span>{String(index+1).padStart(2,"0")}</span></div>
              <div className="block-content"><div className="block-type"><span className={"type-icon " + block.kind}><Blocks size={13}/></span><strong>{catalog.find(c=>c.kind===block.kind)?.label ?? block.kind}</strong><span className="block-kind">{block.kind.toUpperCase()}</span></div>
                <div className="block-fields">
                  {block.kind === "let" && <VariableBlock block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} typePanelOpen={typePanelFor === block.id} onToggleTypePanel={() => setTypePanelFor(typePanelFor === block.id ? null : block.id)} onUpdateType={updateType} />}
                  {block.kind === "input" && <InputBlock block={block} updateBlock={updateBlock} typePanelOpen={typePanelFor === block.id} onToggleTypePanel={() => setTypePanelFor(typePanelFor === block.id ? null : block.id)} onUpdateType={updateType} />}
                  {block.kind === "print" && <PrintBlock block={block} renderValueSlot={renderValueSlot} />}
                  {(block.kind === "get" || block.kind === "add" || block.kind === "compare") && <ReporterContent block={block} renderValueSlot={renderValueSlot} updateBlock={updateBlock} />}
                  {block.kind === "if" && <IfConditionField block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} onDrop={onDrop} />}
                  {block.kind === "repeat" && <RepeatBlock block={block} renderValueSlot={renderValueSlot} />}
                  
                  {(block.kind === "true" || block.kind === "false") && <span className="field-hint">{block.kind === "true" ? "Always true" : "Always false"}</span>}
                </div>
                {(block.kind === "if" || block.kind === "repeat") && <div className="nested-flow" data-drop-into={block.id} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,block.id)}>
                  <div className="nested-label">{block.kind === "if" ? "THEN" : "REPEAT BODY"} <span>DROP BLOCKS HERE</span></div>
                  {(block.children ?? []).map((child,i)=><div className="nested-item" key={child.id} data-block-id={child.id} data-drop-into={child.kind==="if"||child.kind==="repeat"?child.id:undefined} draggable onDragOver={e=>e.preventDefault()} onDrop={e=>{e.stopPropagation();onDrop(e,child.id);}} onClick={e=>{e.stopPropagation();selectBlock(e as unknown as MouseEvent,child.id);}} onDragStart={e=>onDragStart(e,{source:"canvas",ids:selected.includes(child.id)?selected:(block.children??[]).slice(i).map(sibling=>sibling.id)})} onDragEnd={onBlockDragEnd}>
                    <span className="nested-grip"><GripVertical size={12}/></span><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong>{(child.kind==="let"||child.kind==="input")&&<input aria-label="Nested variable name" value={child.name??""} onChange={e=>updateBlock(child.id,{name:e.target.value})} onClick={e=>e.stopPropagation()}/>}<input className="nested-expression" aria-label="Nested block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/>
                  </div>)}
                  {!(block.children ?? []).length && <div className="nested-empty">Drop blocks into this area</div>}
                  {block.kind === "if" && (block.elseIf ?? []).map(branch=><div className="branch-panel" key={branch.id} data-drop-into={branch.id} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,branch.id)}><label className="branch-heading">ELSE IF <input value={branch.condition} onChange={e=>updateBranch(branch.id,e.target.value)} onClick={e=>e.stopPropagation()}/></label><div className="nested-label">BRANCH BODY</div>{branch.children.map(child=><div className="nested-item" key={child.id}><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong><input className="nested-expression" aria-label="Else-if block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/></div>)}</div>)}
                  {block.kind === "if" && block.elseChildren && <div className="branch-panel" data-drop-into={block.elseId} onDragOver={e=>e.preventDefault()} onDrop={e=>block.elseId&&onDrop(e,block.elseId)}><div className="branch-heading">ELSE</div>{block.elseChildren.map(child=><div className="nested-item" key={child.id}><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong><input className="nested-expression" aria-label="Else block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/></div>)}</div>}
                  {block.kind === "if" && <div className="branch-actions"><button onClick={e=>{e.stopPropagation();addElseIf(block.id)}}><Plus size={11}/> Else if</button><button onClick={e=>{e.stopPropagation();toggleElse(block.id)}}><Plus size={11}/> Else</button></div>}
                </div>}
              </div>
            </article>)}
          {snapGhost && (() => { const reporter = snapGhost.targetId.startsWith("__value__:") && dragPreview?.ids.length === 1 ? allBlocks(blocks).find(item => item.id === dragPreview.ids[0] && ["add","compare","true","false","get"].includes(item.kind)) : undefined; return reporter ? <div className="snap-ghost value-snap-ghost" style={{left:snapGhost.x,top:snapGhost.y}} aria-hidden="true"><span className={"value-chip kind-" + reporter.kind}><ReporterContent block={reporter} renderValueSlot={renderValueSlot} updateBlock={updateBlock} /></span></div> : <div className="snap-ghost" style={{left:snapGhost.x,top:snapGhost.y}} aria-hidden="true"><span/>{snapGhost.count > 1 ? `${snapGhost.count} blocks` : "SNAP HERE"}</div>; })()}
          <div className="connector last-connector"><span/></div><button className="add-inline" onClick={()=>addBlock("print")}><Plus size={14}/> Add block to flow</button>
          
        </div>
        <div className="editor-footer"><span><span className="footer-dot"/> {selected.length} selected <span className="footer-separator">·</span> {totalBlocks} blocks in flow</span><span>SPACE + DRAG TO PAN · DELETE TO REMOVE</span></div>
      </section>
    </section>
    <div className="pane-resizer" role="separator" aria-label="Resize workspace and terminal" onPointerDown={e=>{resizeOrigin.current={y:e.clientY,ratio:workspaceRatio};document.body.classList.add("resizing-pane");}}><span/><span/><span/></div>
    <TerminalPanel stdin={stdin} onStdinChange={setStdin} output={output} status={status} onClear={()=>{setOutput("");setStatus("idle");}} hasCompileErrors={!!(compiled.errors.length || assemblyCompiled.errors.length)} blockCount={blocks.length} />
    <footer className="statusbar"><span><span className="status-light"/> {serverOnline === false ? "Server connection unavailable" : "Ready"} <span className="statusbar-path">/ main.blorr</span></span><span>UTF-8 <b>·</b> TYPESCRIPT <b>·</b> <ChevronDown size={12}/></span></footer>
  </main>;
}
