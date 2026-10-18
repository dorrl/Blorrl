import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Play, Hammer, Plus, Terminal, Blocks, ChevronDown, CircleHelp, Download, RotateCcw, Search, GripVertical, GitBranch, Check } from "lucide-react";
import { compile, compileAssembly, runProgram, type Block, type BlockKind, type ValueType } from "./language";

const initialBlocks: Block[] = [
  { id: "b1", kind: "print", value: "Hello from Blorrl!" },
  { id: "b2", kind: "let", name: "answer", value: "42", types: ["number"] },
  { id: "b3", kind: "get", value: "answer" },
];
const catalog: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: "print", label: "Print", hint: "Write a value to terminal" },
  { kind: "let", label: "Variable", hint: "Store a value" },
  { kind: "input", label: "Input", hint: "Read a line from stdin" },
  { kind: "get", label: "Get variable", hint: "Output a variable value" },
  { kind: "if", label: "If condition", hint: "Run a block when true" },
  { kind: "repeat", label: "Repeat", hint: "Repeat a number of times" },
  { kind: "add", label: "Calculate", hint: "Drag into a value socket" },
  { kind: "true", label: "True", hint: "Boolean true value" },
  { kind: "false", label: "False", hint: "Boolean false value" },
  { kind: "compare", label: "==", hint: "Compare values; drag into a value socket" },
];
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
  const [marquee, setMarquee] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [positions, setPositions] = useState<Record<string,{x:number;y:number}>>({});
  const [workspaceRatio, setWorkspaceRatio] = useState(68);
  const [spaceDown, setSpaceDown] = useState(false);
  const [typePanelFor, setTypePanelFor] = useState<string | null>(null);
  const panOrigin = useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const dragOrigin = useRef<{x:number;y:number;ids:string[];origins:Record<string,{x:number;y:number}>}|null>(null); 
  const blockPointerDrag = useRef<BlockPointerDrag | null>(null);
  const [snapGhost, setSnapGhost] = useState<SnapGhost | null>(null);
  const snapGhostRef = useRef<SnapGhost | null>(null);
  snapGhostRef.current = snapGhost;
  const resizeOrigin = useRef<{y:number;ratio:number}|null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const canvasRef = useRef<HTMLDivElement>(null);
  const marqueeStart = useRef<{x:number;y:number}|null>(null);
  const compiled = useMemo(() => compile(blocks), [blocks]);
  const assemblyCompiled = useMemo(() => compileAssembly(blocks), [blocks]);
  const visibleCatalog = catalog.filter(item => (item.label + " " + item.hint).toLowerCase().includes(query.toLowerCase()));
  const allBlocks = (items: Block[]): Block[] => items.flatMap(b => [b, ...(b.conditionBlock ? allBlocks([b.conditionBlock]) : []), ...(b.valueBlock ? allBlocks([b.valueBlock]) : []), ...(b.rightBlock ? allBlocks([b.rightBlock]) : []), ...allBlocks(b.children ?? []), ...(b.elseIf ?? []).flatMap(br => allBlocks(br.children)), ...allBlocks(b.elseChildren ?? [])]);
  const totalBlocks = allBlocks(blocks).length;

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { setSpaceDown(true); event.preventDefault(); }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        const remove = (items: Block[]): Block[] => items.filter(b => !selected.includes(b.id)).map(b => ({...b,conditionBlock:b.conditionBlock && !selected.includes(b.conditionBlock.id) ? b.conditionBlock : undefined,children:remove(b.children??[]),elseIf:b.elseIf?.map(br=>({...br,children:remove(br.children)})),elseChildren:b.elseChildren?remove(b.elseChildren):undefined}));
        setBlocks(current=>remove(current));setSelected([]);setStatus("idle");
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
      if (!origin) return;
      setWorkspaceRatio(Math.max(30, Math.min(85, origin.ratio + (event.clientY - origin.y) / Math.max(1, window.innerHeight) * 100)));
    };
    const handleResizeEnd = () => { resizeOrigin.current = null; document.body.classList.remove("resizing-pane"); };
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
      const next: Record<string, { x: number; y: number }> = { ...positionsRef.current };
      drag.ids.forEach(id => {
        const origin = drag.origins[id];
        if (origin) next[id] = { x: Math.max(12, origin.x + dx), y: Math.max(64, origin.y + dy) };
      });
      setPositions(next);

      const candidate = Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]"))
        .filter(element => !drag.ids.includes(element.dataset.blockId ?? "") && !["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind=>element.classList.contains(kind)))
        .map(element => {
          const rect = element.getBoundingClientRect();
          const id = element.dataset.blockId;
          return id ? {
            id,
            x: element.offsetLeft,
            y: element.offsetTop + element.offsetHeight - 8,
            distance: Math.abs(event.clientY - rect.bottom),
            horizontal: event.clientX >= rect.left - 14 && event.clientX <= rect.right + 14
          } : null;
        })
        .filter((item): item is { id: string; x: number; y: number; distance: number; horizontal: boolean } => item !== null && item.distance < 18 && item.horizontal)
        .sort((a, b) => a.distance - b.distance)[0];

      const startNode = canvas.querySelector<HTMLElement>(".start-node");
      const startRect = startNode?.getBoundingClientRect();
      const startCandidate = startNode && startRect ? {
        id: "__start",
        x: startNode.offsetLeft,
        y: startNode.offsetTop + startNode.offsetHeight - 8,
        distance: Math.abs(event.clientY - startRect.bottom),
        horizontal: event.clientX >= startRect.left - 14 && event.clientX <= startRect.right + 14
      } : null;
      const canvasRect = canvas.getBoundingClientRect();
      const movingElement = drag.ids.length === 1 ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${drag.ids[0]}"]`) : null;
      const canBeCondition = !!movingElement && ["kind-true","kind-false","kind-compare"].some(kind => movingElement.classList.contains(kind));
      const canBeValue = !!movingElement && ["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind=>movingElement.classList.contains(kind));
      const valueCandidate = canBeValue ? Array.from(canvas.querySelectorAll<HTMLElement>(".value-slot[data-value-for][data-value-field]"))
        .map(slot=>{const rect=slot.getBoundingClientRect();const inside=event.clientX>=rect.left-4&&event.clientX<=rect.right+4&&event.clientY>=rect.top-4&&event.clientY<=rect.bottom+4;return inside?{id:"__value__:"+slot.dataset.valueFor+":"+slot.dataset.valueField,x:rect.left-canvasRect.left+canvas.scrollLeft,y:rect.top-canvasRect.top+canvas.scrollTop,distance:0,horizontal:true}:null;}).find(item=>item!==null)??null:null;
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
      const ghost = snapGhostRef.current;
      if (ghost) {
        const canvas = canvasRef.current;
        const next: Record<string, { x: number; y: number }> = { ...positionsRef.current };
        if (ghost.targetId.startsWith("__value__:")) {
          const [,targetId,field] = ghost.targetId.split(":");
          setBlocks(current=>{
            const child=allBlocks(current).find(block=>drag.ids.includes(block.id));
            if(!child || !["add","compare","true","false","get"].includes(child.kind) || !targetId || (field!=="valueBlock"&&field!=="rightBlock")) return current;
            return putValue(removeIds(current,drag.ids),targetId,field,child);
          });
          drag.ids.forEach(id=>delete next[id]);
          setSelected(drag.ids.slice(0,1));
        } else if (ghost.targetId.startsWith("__condition__:")) {
          const targetId = ghost.targetId.slice("__condition__:".length);
          setBlocks(current => {
            const child = current.find(block => drag.ids.includes(block.id));
            if (!child || (child.kind !== "true" && child.kind !== "false" && child.kind !== "compare")) return current;
            return putCondition(removeIds(current, drag.ids), targetId, child);
          });
          drag.ids.forEach(id => delete next[id]);
          setSelected(drag.ids.slice(0,1));
        } else {
          const movingHeight = drag.ids.reduce((sum,id) => sum + (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 8, 0);
          setBlocks(current => {
            const moving = current.filter(block => drag.ids.includes(block.id));
            const rest = current.filter(block => !drag.ids.includes(block.id));
            const targetIndex = ghost.targetId === "__start" ? -1 : rest.findIndex(block => block.id === ghost.targetId);
            rest.splice(ghost.targetId === "__start" ? 0 : targetIndex < 0 ? rest.length : targetIndex + 1, 0, ...moving);
            return rest;
          });
          Object.entries(next).forEach(([id, point]) => {
            if (!drag.ids.includes(id) && point.y >= ghost.y) next[id] = {x:point.x,y:point.y+movingHeight};
          });
          let y = ghost.y;
          drag.ids.forEach(id => {
            next[id] = { x: ghost.x, y };
            const movingElement = canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`);
            y += (movingElement?.offsetHeight ?? 38) - 8;
          });
        }
        setPositions(next);
        setStatus("idle");
      }
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
      ...block, conditionBlock:block.conditionBlock ? update([block.conditionBlock])[0] : undefined, children:update(block.children ?? []),
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
    if (["add","compare","true","false","get"].includes(kind) && !beforeId && !dropPoint) { setOutput("Drag this value block into a value socket."); setStatus("idle"); return; }
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
  function removeIds(items: Block[], ids: string[]): Block[] {
    return items.filter(b => !ids.includes(b.id)).map(b => ({...b, conditionBlock:b.conditionBlock && !ids.includes(b.conditionBlock.id) ? b.conditionBlock : undefined, valueBlock:b.valueBlock && !ids.includes(b.valueBlock.id) ? b.valueBlock : undefined, rightBlock:b.rightBlock && !ids.includes(b.rightBlock.id) ? b.rightBlock : undefined, children: removeIds(b.children ?? [], ids), elseIf: b.elseIf?.map(br => ({...br, children: removeIds(br.children, ids)})), elseChildren: b.elseChildren ? removeIds(b.elseChildren, ids) : undefined}));
  }
  function putValue(items: Block[], targetId: string, field: "valueBlock" | "rightBlock", valueBlock: Block): Block[] {
    return items.map(b=>({...b,[field]:b.id===targetId?valueBlock:b[field],conditionBlock:b.conditionBlock?putValue([b.conditionBlock],targetId,field,valueBlock)[0]:undefined,valueBlock:b.id===targetId&&field==="valueBlock"?valueBlock:b.valueBlock?putValue([b.valueBlock],targetId,field,valueBlock)[0]:undefined,rightBlock:b.id===targetId&&field==="rightBlock"?valueBlock:b.rightBlock?putValue([b.rightBlock],targetId,field,valueBlock)[0]:undefined,children:putValue(b.children??[],targetId,field,valueBlock),elseIf:b.elseIf?.map(br=>({...br,children:putValue(br.children,targetId,field,valueBlock)})),elseChildren:b.elseChildren?putValue(b.elseChildren,targetId,field,valueBlock):undefined}));
  }
  function renderValueSlot(owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) {
    const nested=owner[field];
    const label=nested?.kind==="add" ? `${nested.valueBlock ? valueLabel(nested.valueBlock) : nested.value || "0"} ${nested.operator??"+"} ${nested.rightBlock ? valueLabel(nested.rightBlock) : nested.right||"1"}` : nested?.kind==="compare" ? `${nested.valueBlock ? valueLabel(nested.valueBlock) : nested.value||"0"} ${nested.comparisonOperator??"=="} ${nested.rightBlock ? valueLabel(nested.rightBlock) : nested.right||"0"}` : nested?.kind==="get" ? `get ${nested.value}` : nested?.kind==="true" ? "true" : nested?.kind==="false" ? "false" : "";
    return <div className={"value-slot"+(nested?" filled":"")} data-value-for={owner.id} data-value-field={field} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("value-hover");}} onDragLeave={e=>e.currentTarget.classList.remove("value-hover")} onDrop={e=>{e.currentTarget.classList.remove("value-hover");onDrop(e,`value:${owner.id}:${field}`);}}>{nested?<><span className={"value-chip kind-"+nested.kind}>{label}</span><button className="value-remove" aria-label="Remove nested value" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();updateBlock(owner.id,{[field]:undefined});}}>×</button></>:<input className="value-input" aria-label={ariaLabel} value={value} onChange={e=>updateBlock(owner.id,{[field==="valueBlock"?"value":"right"]:e.target.value})} onClick={e=>e.stopPropagation()}/>}</div>;
  }
  function valueLabel(block: Block): string { return block.kind==="get" ? `get ${block.value}` : block.kind==="true" ? "true" : block.kind==="false" ? "false" : block.kind==="compare" ? `${block.value} ${block.comparisonOperator??"=="} ${block.right??"0"}` : `${block.value} ${block.operator??"+"} ${block.right??"1"}`; }
  function putCondition(items: Block[], targetId: string, conditionBlock: Block): Block[] {
    return items.map(b => ({...b, conditionBlock:b.id===targetId ? conditionBlock : b.conditionBlock ? putCondition([b.conditionBlock],targetId,conditionBlock)[0] : undefined, children:putCondition(b.children??[],targetId,conditionBlock), elseIf:b.elseIf?.map(br=>({...br,children:putCondition(br.children,targetId,conditionBlock)})), elseChildren:b.elseChildren?putCondition(b.elseChildren,targetId,conditionBlock):undefined}));
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
    const update = (items: Block[]): Block[] => items.map(b => ({...b,elseIf:b.id===id?[...(b.elseIf??[]),{id:crypto.randomUUID(),condition:"false",children:[]}]:b.elseIf,children:update(b.children??[]),elseIf:b.elseIf?.map(br=>({...br,children:update(br.children)})),elseChildren:b.elseChildren?update(b.elseChildren):undefined}));
    setBlocks(update); setStatus("idle");
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
      const ids = selected.includes(payload.ids[0]) ? selected : payload.ids;
      const origins: Record<string,{x:number;y:number}> = {};
      ids.forEach(id => { origins[id] = positionsRef.current[id] ?? {x:42,y:104 + blocks.findIndex(b=>b.id===id)*104}; });
      dragOrigin.current = {x:event.clientX,y:event.clientY,ids,origins};
    }
  }
  function onBlockDragEnd(event: DragEvent, id: string) {
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
      let y = snapped.p.y + (targetEl?.offsetHeight ?? 50) - 8;
      drag.ids.forEach(item => { next[item]={x:snapped.p.x,y}; y += (canvas?.querySelector<HTMLElement>(`[data-block-id="${item}"]`)?.offsetHeight ?? 92)-8; });
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
      const target=targetId ? allBlocks(blocks).find(b=>b.id===targetId) : undefined;
      const branchTarget=!!targetId && allBlocks(blocks).some(b=>b.elseId===targetId||(b.elseIf??[]).some(br=>br.id===targetId));
      if (targetId && ((target && (target.kind==="if" || target.kind==="repeat")) || branchTarget)) {
        if(payload.source==="library") insertNested(targetId,makeBlock(payload.kind));
        else nestBlocks(targetId,payload.ids);
      } else if(payload.source==="library") {
        const rect=canvasRef.current?.getBoundingClientRect();
        const point=rect&&canvasRef.current?{x:Math.max(12,event.clientX-rect.left+canvasRef.current.scrollLeft-150),y:Math.max(64,event.clientY-rect.top+canvasRef.current.scrollTop-24)}:undefined;
        addBlock(payload.kind, targetId, point);
      } else moveSelection(payload.ids,targetId);
    } catch { /* Ignore invalid drag payloads. */ }
  }
  function startMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (spaceDown || event.button===1) {
      panOrigin.current={x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop};
      event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();return;
    }
    if ((event.target as HTMLElement).closest(".block-card,button,input,textarea,select,.start-node")) return;
    const rect=event.currentTarget.getBoundingClientRect();
    const point={x:event.clientX-rect.left+event.currentTarget.scrollLeft,y:event.clientY-rect.top+event.currentTarget.scrollTop};
    marqueeStart.current=point;setMarquee({...point,w:0,h:0});event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas=canvasRef.current;if(!canvas)return;
    if(panOrigin.current){canvas.scrollLeft=panOrigin.current.left-(event.clientX-panOrigin.current.x);canvas.scrollTop=panOrigin.current.top-(event.clientY-panOrigin.current.y);return;}
    if(!marqueeStart.current)return;
    const rect=canvas.getBoundingClientRect();
    const x=event.clientX-rect.left+canvas.scrollLeft,y=event.clientY-rect.top+canvas.scrollTop,start=marqueeStart.current;
    const box={x:Math.min(start.x,x),y:Math.min(start.y,y),w:Math.abs(x-start.x),h:Math.abs(y-start.y)};setMarquee(box);
    const ids=Array.from(canvas.querySelectorAll<HTMLElement>("[data-block-id]")).filter(el=>{
      const r=el.getBoundingClientRect(),left=r.left-rect.left+canvas.scrollLeft,top=r.top-rect.top+canvas.scrollTop;
      return left<box.x+box.w&&left+r.width>box.x&&top<box.y+box.h&&top+r.height>box.y;
    }).map(el=>el.dataset.blockId!).filter(Boolean);
    setSelected(ids);
  }
  function endMarquee() { marqueeStart.current=null;panOrigin.current=null;setMarquee(null); }
  function selectBlock(event: MouseEvent, id: string) {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    } else if (!selected.includes(id)) setSelected([id]);
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
  function build() {
    setOutput(assemblyCompiled.errors.length ? assemblyCompiled.errors.join("\n") : assemblyCompiled.code);
    setStatus(assemblyCompiled.errors.length ? "error" : "built");
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
  function exportSource() {
    const blob = new Blob([assemblyCompiled.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "main.s"; a.click(); URL.revokeObjectURL(url);
  }

  return <main className="studio">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Blocks size={18}/></span><span>blorrl<span className="brand-dot">.</span></span><span className="studio-tag">STUDIO</span></a>
      <div className="top-meta"><span className="live-dot"/><span>WORKSPACE</span><span className="version">develop / main.blorr</span></div>
      <div className="top-actions"><span className={"server-indicator " + (serverOnline === true ? "online" : serverOnline === false ? "offline" : "")}><span/>{serverOnline === true ? "SERVER CONNECTED" : serverOnline === false ? "SERVER OFFLINE" : "CONNECTING"}</span><button className="icon-button" title="Language guide" onClick={() => setShowHelp(v => !v)}><CircleHelp size={16}/></button><button className="subtle-button" onClick={() => {setBlocks(initialBlocks);setSelected(["b1"]);setStatus("idle");}}><RotateCcw size={13}/> Reset</button><button className="build-button" onClick={build}><Hammer size={14}/> Source</button><button className="build-button" disabled={busy} onClick={() => downloadBuild("assembly")}><Download size={13}/> .s</button><button className="build-button" disabled={busy} onClick={() => downloadBuild("exe")}><Download size={13}/> .exe</button><button className="run-button" disabled={busy} onClick={run}><Play size={14} fill="currentColor"/> Run</button></div>
    </header>
    <section className="workspace" style={{height: `calc(${workspaceRatio}vh - ${76 * workspaceRatio / 100}px)`}}>
      <aside className="sidebar">
        <div className="side-title"><span>EXPLORER</span><span className="side-menu">···</span></div>
        <div className="project-row"><ChevronDown size={13}/><span className="folder-glyph">▣</span><strong>BLORRL PROJECT</strong></div>
        <div className="file-row"><span className="file-glyph">B</span><span>main.blorr</span><span className="file-unsaved"/></div>
        <div className="library-head"><span>BLOCKS</span><span>{visibleCatalog.length.toString().padStart(2,"0")}</span></div>
        <div className="library-search"><Search size={13}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter blocks"/></div>
        <div className="catalog-list">
          {visibleCatalog.map(item => <button key={item.kind} className="catalog-item" draggable onDragStart={e => onDragStart(e,{source:"library",kind:item.kind})} onClick={() => addBlock(item.kind)} title="Click to add or drag into the workspace"><span className={"catalog-icon " + item.kind}><Plus size={14}/></span><span className="catalog-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><GripVertical size={14} className="catalog-grip"/></button>)}
        </div>
        <div className="sidebar-bottom"><div className="sidebar-section-label">OUTLINE</div><div className="outline-row"><GitBranch size={13}/><span>main</span><span className="outline-count">{blocks.length}</span></div><div className="sidebar-note">Space + drag pans. Drag empty space to select; drag blocks to move them. Delete/Backspace removes selection.</div></div>
      </aside>
      <section className="editor">
        <div className="tabbar"><div className="editor-tab"><span className="tab-file-icon">B</span>main.blorr<span className="tab-unsaved"/></div><div className="tabbar-spacer"/><span className="tab-language">BLORRL</span><button className="icon-button tab-export" title="Export source" onClick={exportSource}><Download size={15}/></button></div>
        <div className="breadcrumb"><span>main.blorr</span><span>›</span><span>main</span><span className="breadcrumb-right">{totalBlocks} blocks</span></div>
        <div className="pane-heading"><div><span className="pane-eyebrow">VISUAL EDITOR</span><h1>Program flow</h1></div><div className="pane-tools"><span className="saved-indicator"><span/> All changes local</span><button className="icon-button" title="Export source" onClick={exportSource}><Download size={15}/></button></div></div>
        {showHelp && <div className="help-panel"><strong>Quick language guide</strong><p>Space + drag pans the canvas. Drag empty space to select blocks. Drag blocks to move them or drop them into a control block to nest them. Delete/Backspace removes selected blocks. Add else-if/else branches from an if block.</p><code>print "hello";</code></div>}
        <div className={"block-canvas " + (spaceDown ? "space-pan" : "")} ref={canvasRef} onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={endMarquee} onPointerCancel={endMarquee} onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e)}>
          <div className="canvas-ruler"><span>PROGRAM ENTRY</span><span>{spaceDown ? "SPACE + DRAG TO PAN" : "DRAG EMPTY SPACE TO SELECT"}</span></div>
          <div className="start-node" style={{left:42,top:38}}><span className="start-play"><Play size={13} fill="currentColor"/></span><div><strong>Start</strong><small>Program entry point · fixed</small></div><span className="fixed-pill"><Check size={10}/> FIXED</span></div>
          <div className="flow-stem"><span/></div>
          {blocks.length === 0 && <div className="empty-state"><Blocks size={26}/><strong>Drop a block to begin</strong><span>Drag from the Explorer or click a block on the left.</span></div>}
          {blocks.map((block,index) => <article key={block.id} data-block-id={block.id} data-drop-into={block.kind === "if" || block.kind === "repeat" ? block.id : undefined} style={{left:positions[block.id]?.x ?? 42,top:positions[block.id]?.y ?? (90 + index*86),touchAction:"none"}} className={"block-card kind-" + block.kind + (selected.includes(block.id) ? " selected" : "")} onPointerDown={e => {
            if (spaceDown || e.button !== 0 || (e.target as HTMLElement).closest("input,button,select,textarea")) return;
            e.preventDefault();
            e.stopPropagation();
            const selectedIds = selected.includes(block.id) ? selected : [block.id];
            const blockIndex = blocks.findIndex(item => item.id === block.id);
            const ids = selectedIds.length > 1 ? selectedIds : blocks.slice(Math.max(0,blockIndex)).map(item=>item.id);
            if (!selected.includes(block.id)) setSelected(selectedIds);
            const origins: Record<string,{x:number;y:number}> = {};
            ids.forEach(id => { origins[id] = positionsRef.current[id] ?? {x:42,y:104 + blocks.findIndex(item=>item.id===id)*104}; });
            blockPointerDrag.current = {pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,ids,origins};
            snapGhostRef.current = null;
            setSnapGhost(null);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }} onClick={e => selectBlock(e,block.id)} onDragOver={e => {e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("drop-target");}} onDragLeave={e => e.currentTarget.classList.remove("drop-target")} onDrop={e => {e.currentTarget.classList.remove("drop-target");onDrop(e,block.id);}}>
              <div className="block-gutter"><GripVertical size={14}/><span>{String(index+1).padStart(2,"0")}</span></div>
              <div className="block-content"><div className="block-type"><span className={"type-icon " + block.kind}><Blocks size={13}/></span><strong>{catalog.find(c=>c.kind===block.kind)?.label ?? block.kind}</strong><span className="block-kind">{block.kind.toUpperCase()}</span></div>
                <div className="block-fields">
                  {block.kind === "let" && <><label>NAME<input value={block.name ?? ""} onChange={e=>updateBlock(block.id,{name:e.target.value})} onClick={e=>e.stopPropagation()} /></label><label>VALUE{renderValueSlot(block,"valueBlock",block.value,"Variable value")}</label><button className="type-panel-button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setTypePanelFor(typePanelFor===block.id?null:block.id)}}>Types · {(block.types ?? ["number"]).join(", ")}</button>{typePanelFor===block.id && <div className="type-panel" onPointerDown={e=>e.stopPropagation()}><strong>Variable types</strong>{(["number","string","boolean"] as ValueType[]).map(type=><label key={type}><input type="checkbox" checked={(block.types ?? ["number"]).includes(type)} onChange={e=>updateType(block.id,type,e.target.checked)}/>{type}</label>)}</div>}</>}
                  {block.kind === "input" && <><label>STORE AS<input value={block.name ?? ""} onChange={e=>updateBlock(block.id,{name:e.target.value})} onClick={e=>e.stopPropagation()} /></label><button className="type-panel-button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setTypePanelFor(typePanelFor===block.id?null:block.id)}}>Types · {(block.types ?? ["number"]).join(", ")}</button>{typePanelFor===block.id && <div className="type-panel" onPointerDown={e=>e.stopPropagation()}><strong>Input types</strong>{(["number","string","boolean"] as ValueType[]).map(type=><label key={type}><input type="checkbox" checked={(block.types ?? ["number"]).includes(type)} onChange={e=>updateType(block.id,type,e.target.checked)}/>{type}</label>)}</div>}<span className="field-hint">Reads one line from terminal input</span></>}
                  {block.kind === "print" && <label className="wide-field">TEXT{renderValueSlot(block,"valueBlock",block.value,"Print text or drop a value block")}</label>}
                  {block.kind === "get" && <label>VARIABLE<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label>}
                  {block.kind === "if" && <div className="condition-slot" data-condition-for={block.id} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("condition-hover");}} onDragLeave={e=>e.currentTarget.classList.remove("condition-hover")} onDrop={e=>{e.currentTarget.classList.remove("condition-hover");onDrop(e,"condition:"+block.id);}}><span className="condition-caption">IF</span>{block.conditionBlock ? <><strong>{block.conditionBlock.kind==="true"?"True":block.conditionBlock.kind==="false"?"False":"Compare"}</strong>{block.conditionBlock.kind==="compare" && <span>{block.conditionBlock.value} {block.conditionBlock.comparisonOperator??"=="} {block.conditionBlock.right??"0"}</span>}</> : <span>Drop True / False / Compare</span>}</div>}
                  {block.kind === "repeat" && <label>COUNT<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label>}
                  {(block.kind === "add" || block.kind === "compare") && <div className={"operator-fields "+(block.kind==="compare"?"comparison-fields":"calculate-fields")}>{renderValueSlot(block,"valueBlock",block.value,"Left value")}<select aria-label="Operator" value={block.kind === "compare" ? block.comparisonOperator ?? "==" : block.operator ?? "+"} onChange={e=>updateBlock(block.id,block.kind === "compare" ? {comparisonOperator:e.target.value as Block["comparisonOperator"]} : {operator:e.target.value as Block["operator"]})} onClick={e=>e.stopPropagation()}>{block.kind === "compare" ? <><option>==</option><option>&gt;=</option><option>&lt;=</option></> : <><option>+</option><option>-</option><option>*</option><option>/</option></>}</select>{renderValueSlot(block,"rightBlock",block.right ?? (block.kind === "compare" ? "0" : "1"),"Right value")}</div>}
                  {(block.kind === "true" || block.kind === "false") && <span className="field-hint">{block.kind === "true" ? "Always true" : "Always false"}</span>}
                </div>
                {(block.kind === "if" || block.kind === "repeat") && <div className="nested-flow" data-drop-into={block.id} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,block.id)}>
                  <div className="nested-label">{block.kind === "if" ? "THEN" : "REPEAT BODY"} <span>DROP BLOCKS HERE</span></div>
                  {(block.children ?? []).map((child,i)=><div className="nested-item" key={child.id} data-block-id={child.id} data-drop-into={child.kind==="if"||child.kind==="repeat"?child.id:undefined} draggable onDragOver={e=>e.preventDefault()} onDrop={e=>{e.stopPropagation();onDrop(e,child.id);}} onClick={e=>{e.stopPropagation();selectBlock(e as unknown as MouseEvent,child.id);}} onDragStart={e=>onDragStart(e,{source:"canvas",ids:selected.includes(child.id)?selected:[child.id]})} onDragEnd={e=>onBlockDragEnd(e,child.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.stopPropagation();onDrop(e,child.id);}}>
                    <span className="nested-grip"><GripVertical size={12}/></span><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong>{(child.kind==="let"||child.kind==="input")&&<input aria-label="Nested variable name" value={child.name??""} onChange={e=>updateBlock(child.id,{name:e.target.value})} onClick={e=>e.stopPropagation()}/>}<input className="nested-expression" aria-label="Nested block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/>
                  </div>)}
                  {!(block.children ?? []).length && <div className="nested-empty">Drop blocks into this area</div>}
                  {block.kind === "if" && (block.elseIf ?? []).map(branch=><div className="branch-panel" key={branch.id} data-drop-into={branch.id} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,branch.id)}><label className="branch-heading">ELSE IF <input value={branch.condition} onChange={e=>updateBranch(branch.id,e.target.value)} onClick={e=>e.stopPropagation()}/></label><div className="nested-label">BRANCH BODY</div>{branch.children.map(child=><div className="nested-item" key={child.id}><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong><input className="nested-expression" aria-label="Else-if block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/></div>)}</div>)}
                  {block.kind === "if" && block.elseChildren && <div className="branch-panel" data-drop-into={block.elseId} onDragOver={e=>e.preventDefault()} onDrop={e=>block.elseId&&onDrop(e,block.elseId)}><div className="branch-heading">ELSE</div>{block.elseChildren.map(child=><div className="nested-item" key={child.id}><strong>{catalog.find(c=>c.kind===child.kind)?.label ?? child.kind}</strong><input className="nested-expression" aria-label="Else block value" value={child.value} onChange={e=>updateBlock(child.id,{value:e.target.value})} onClick={e=>e.stopPropagation()}/></div>)}</div>}
                  {block.kind === "if" && <div className="branch-actions"><button onClick={e=>{e.stopPropagation();addElseIf(block.id)}}><Plus size={11}/> Else if</button><button onClick={e=>{e.stopPropagation();toggleElse(block.id)}}><Plus size={11}/> Else</button></div>}
                </div>}
              </div>
            </article>)}
          {snapGhost && <div className="snap-ghost" style={{left:snapGhost.x,top:snapGhost.y}} aria-hidden="true"><span/>{snapGhost.count > 1 ? `${snapGhost.count} blocks` : "SNAP HERE"}</div>}
          <div className="connector last-connector"><span/></div><button className="add-inline" onClick={()=>addBlock("print")}><Plus size={14}/> Add block to flow</button>
          {marquee && <div className="selection-marquee" style={{left:marquee.x,top:marquee.y,width:marquee.w,height:marquee.h}}/>}
        </div>
        <div className="editor-footer"><span><span className="footer-dot"/> {selected.length} selected <span className="footer-separator">·</span> {totalBlocks} blocks in flow</span><span>SPACE + DRAG TO PAN · DELETE TO REMOVE</span></div>
      </section>
    </section>
    <div className="pane-resizer" role="separator" aria-label="Resize workspace and terminal" onPointerDown={e=>{resizeOrigin.current={y:e.clientY,ratio:workspaceRatio};document.body.classList.add("resizing-pane");}}><span/><span/><span/></div>
    <section className="terminal">
      <div className="terminal-top"><div className="terminal-title"><Terminal size={15}/><strong>TERMINAL</strong><span className="terminal-divider">/</span><span>OUTPUT</span></div><div className="terminal-status"><span className={"status-dot " + status}/>{status==="ran"?"EXECUTED":status==="built"?"BUILD SUCCESS":status==="error"?"ERROR":"IDLE"}<button className="clear-button" onClick={()=>{setOutput("");setStatus("idle");}}>Clear</button></div></div>
      <div className="terminal-body"><div className="terminal-input"><label htmlFor="stdin">STDIN</label><textarea id="stdin" value={stdin} onChange={e=>setStdin(e.target.value)} placeholder="Type input here… (one line per read)" rows={2}/><span>INPUT BUFFER</span></div><div className="terminal-output"><div className="output-label"><span>STDOUT / STDERR</span><span>UTF-8</span></div><pre className={status==="error"?"error-text":""}>{output}</pre></div></div>
      <div className="terminal-bottom"><span>BLORRL RUNTIME <b>·</b> NATIVE BUILD VIA ZIG</span><span>COMPILE <b>·</b> {compiled.errors.length || cCompiled.errors.length ? "ERRORS" : "INSTANT"}</span></div>
    </section>
    <footer className="statusbar"><span><span className="status-light"/> {serverOnline === false ? "Server connection unavailable" : "Ready"} <span className="statusbar-path">/ main.blorr</span></span><span>UTF-8 <b>·</b> TYPESCRIPT <b>·</b> <ChevronDown size={12}/></span></footer>
  </main>;
}
