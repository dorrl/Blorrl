import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Play, Plus, Blocks, ChevronDown, CircleHelp, Download, RotateCcw, GripVertical, Check, Save, FolderOpen } from "lucide-react";
import { compile, compileAssembly, runProgram, type Block, type BlockKind, type ValueType } from "./language";
import { BlockLibrary } from "./components/BlockLibrary";
import { Calculate } from "./editor/blocks/Calculate";
import { Compare } from "./editor/blocks/Compare";
import { PrintBlock } from "./editor/blocks/Output";
import { VariableBlock, InputBlock } from "./editor/blocks/Variables";
import { IfConditionField, RepeatBlock, ControlBlockBody } from "./editor/blocks/Control";
import { ReporterContent, ValueSlot } from "./editor/blocks/Values";
import { TerminalPanel } from "./components/TerminalPanel";
import { initialBlocks } from "./editor/initialBlocks";
import { catalog } from "./editor/blockCatalog";
import { allBlocks, getStartAttachedBlocks, putCondition, putValue, removeIds } from "./editor/blockTree";
import { createBlock, updateBlockTree } from "./editor/blockOperations";
import { useCanvasPan } from "./editor/useCanvasPan";

type DragPayload = { source: "canvas"; ids: string[] } | { source: "library"; kind: BlockKind };
type BlockPointerDrag = { pointerId: number; startX: number; startY: number; ids: string[]; origins: Record<string, { x: number; y: number }> };
type SnapGhost = { x: number; y: number; count: number; targetId: string };
function categoryClass(kind: BlockKind) { return "category-" + (catalog.find(item => item.kind === kind)?.category ?? "Values").toLowerCase(); }

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
  const [dragPreview, setDragPreview] = useState<{ids:string[]}|null>(null);
  const [libraryDragKind, setLibraryDragKind] = useState<BlockKind | null>(null);
  const snapGhostContentRef = useRef<HTMLDivElement>(null);
  const insertionPreviewElementsRef = useRef<HTMLElement[]>([]);
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
  const executableBlocks = useMemo(() => getStartAttachedBlocks(blocks), [blocks]);
  const compiled = useMemo(() => compile(executableBlocks), [executableBlocks]);
  const assemblyCompiled = useMemo(() => compileAssembly(executableBlocks), [executableBlocks]);
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
      insertionPreviewElementsRef.current.forEach(element => { element.style.transform = ""; element.style.willChange = ""; });
      insertionPreviewElementsRef.current = [];
      drag.ids.forEach(id => { const element = canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`); if (element) { element.style.willChange = "transform"; element.style.transform = `translate(${dx}px, ${dy}px)`; } });

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
      const previousGhost = snapGhostRef.current;
      if (!ghost || !previousGhost || ghost.targetId !== previousGhost.targetId || ghost.x !== previousGhost.x || ghost.y !== previousGhost.y) setSnapGhost(ghost);
      snapGhostRef.current = ghost;
      if (Math.hypot(dx, dy) > 3) event.preventDefault();
    };

    const handleBlockPointerUp = (event: PointerEvent) => {
      const drag = blockPointerDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      blockPointerDrag.current = null;
      const canvas = canvasRef.current;
      drag.ids.forEach(id => { const element = canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`); if (element) { element.style.transform = ""; element.style.willChange = ""; } });
      insertionPreviewElementsRef.current.forEach(element => { element.style.transform = ""; element.style.willChange = ""; });
      insertionPreviewElementsRef.current = [];
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const ghost = snapGhostRef.current;
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
        setBlocks(current => {
          const moving = current.filter(block => drag.ids.includes(block.id));
          const rest = current.filter(block => !drag.ids.includes(block.id));
          const parentId = ghost.targetId === "__start" ? "__start" : ghost.targetId;
          const targetIndex = ghost.targetId === "__start" ? -1 : rest.findIndex(block => block.id === ghost.targetId);
          // Preserve the old successor: after inserting a stack, it must follow
          // the inserted stack's tail, not compete with its first block for parentId.
          if (moving.length) {
            for (let index = 0; index < rest.length; index++) {
              if (rest[index]!.attachedTo === parentId) {
                rest[index] = { ...rest[index]!, attachedTo: moving[moving.length - 1]!.id };
              }
            }
          }
          const attached = moving.map((block, index) => ({
            ...block,
            attachedTo: index === 0 ? parentId : moving[index - 1]!.id,
          }));
          rest.splice(ghost.targetId === "__start" ? 0 : targetIndex < 0 ? rest.length : targetIndex + 1, 0, ...attached);
          return rest;
        });
        // Materialize fallback layout positions before shifting, otherwise blocks
        // without an explicit entry in positions keep their old index-based location.
        blocks.forEach((block, index) => {
          if (!next[block.id]) next[block.id] = positionsRef.current[block.id] ?? {x:42,y:90 + index * 86};
        });
        const insertedHeight = drag.ids.reduce((total, id) =>
          total + (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1, 0);
        const targetElement = ghost.targetId === "__start"
          ? canvas?.querySelector<HTMLElement>(".start-node")
          : canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${ghost.targetId}"]`);
        const targetBottom = targetElement ? targetElement.offsetTop + targetElement.offsetHeight - 10 : ghost.y;
        // Make physical room too; attachment changes alone leave the old successor
        // occupying the same pixels as the newly inserted block.
        Object.entries(next).forEach(([id, point]) => {
          if (!drag.ids.includes(id) && id !== ghost.targetId && point.y >= targetBottom) {
            next[id] = { ...point, y: point.y + insertedHeight };
          }
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
        // Detach only the dragged stack root; its descendants remain connected to each other.
        const rootId = drag.ids[0];
        setBlocks(current => current.map(block => block.id === rootId ? ({ ...block, attachedTo: undefined }) : block));
      }

      setPositions(next);
      setDragPreview(null);
      setDragCanvasExtent(0);
      if (ghost) setStatus("idle");
      snapGhostRef.current = null;
      setSnapGhost(null);
    };

    let moveFrame = 0;
    let latestMove: PointerEvent | null = null;
    const scheduleBlockPointerMove = (event: PointerEvent) => {
      latestMove = event;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        const latest = latestMove;
        latestMove = null;
        if (latest) handleBlockPointerMove(latest);
      });
    };
    const finishBlockPointerMove = (event: PointerEvent) => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      latestMove = null;
      const drag = blockPointerDrag.current;
      if (drag && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) handleBlockPointerMove(event);
      handleBlockPointerUp(event);
    };
    window.addEventListener("pointermove", scheduleBlockPointerMove);
    window.addEventListener("pointerup", finishBlockPointerMove);
    window.addEventListener("pointercancel", finishBlockPointerMove);
    return () => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      window.removeEventListener("pointermove", scheduleBlockPointerMove);
      window.removeEventListener("pointerup", finishBlockPointerMove);
      window.removeEventListener("pointercancel", finishBlockPointerMove);
    };
  }, []);

  useEffect(() => {
    const container = snapGhostContentRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!snapGhost || !canvasRef.current) return;

    if (libraryDragKind) {
      const source = document.querySelector<HTMLElement>(`.library-block-preview.kind-${libraryDragKind}`);
      if (!source) return;
      const ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.remove("selected", "library-block-preview");
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.querySelectorAll<HTMLElement>("input,button,select,textarea").forEach(element => {
        element.setAttribute("disabled", "");
        element.setAttribute("tabindex", "-1");
      });
      // Read the rendered preview's used width before removing its palette-only
      // scaling class. Do not cap it to the canvas width: that makes the ghost
      // narrower than the block that will actually be inserted.
      const sourceWidth = getComputedStyle(source).width;
      Object.assign(ghost.style, {
        position: "relative", left: "auto", top: "auto", transform: "none",
        width: sourceWidth, maxWidth: "none", minWidth: "0",
        minHeight: "0", margin: "0", boxSizing: "border-box", pointerEvents: "none"
      });
      container.appendChild(ghost);
      return;
    }

    if (!dragPreview) return;
    dragPreview.ids.forEach((id, index) => {
      const source = Array.from(canvasRef.current!.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).find(element => element.dataset.blockId === id);
      if (!source) return;
      const clone = source.cloneNode(true) as HTMLElement;
      clone.classList.remove("selected", "ghost-source-hidden");
      clone.removeAttribute("data-block-id");
      clone.removeAttribute("data-drop-into");
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("inert", "");
      clone.querySelectorAll<HTMLElement>("[data-block-id], [data-drop-into]").forEach(element => { element.removeAttribute("data-block-id"); element.removeAttribute("data-drop-into"); });
      clone.querySelectorAll(".delete-block").forEach(element => element.remove());
      clone.querySelectorAll<HTMLElement>("input,button,select,textarea").forEach(element => { element.setAttribute("disabled", ""); element.setAttribute("tabindex", "-1"); });
      clone.querySelectorAll<HTMLElement>(".block-card").forEach(element => { element.style.position = "relative"; element.style.left = "auto"; element.style.top = "auto"; element.style.transform = "none"; element.style.zIndex = "auto"; });
      const sourceRect = source.getBoundingClientRect();
      Object.assign(clone.style, { position: "relative", left: "auto", top: "auto", transform: "none", zIndex: "auto", width: `${sourceRect.width}px`, minHeight: `${sourceRect.height}px`, boxSizing: "border-box", marginTop: index ? "-1px" : "0", pointerEvents: "none" });
      container.appendChild(clone);
    });
  }, [snapGhost?.targetId, dragPreview?.ids.join(","), libraryDragKind]);

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks(current => updateBlockTree(current, id, patch));
    setStatus("idle");
  }
  function addBlock(kind: BlockKind, beforeId?: string, dropPoint?: {x:number;y:number}) {
    const attached = getStartAttachedBlocks(blocks);
    const lastAttached = attached[attached.length - 1];
    const block = createBlock(kind);
    block.attachedTo = beforeId === "__start" ? "__start" : beforeId ?? (dropPoint ? undefined : lastAttached?.id ?? "__start");
    const rect = canvasRef.current?.getBoundingClientRect();
    const targetIndex = beforeId && beforeId !== "__start" ? blocks.findIndex(item => item.id === beforeId) : -1;
    const targetPosition = beforeId === "__start" ? {x:42,y:38} : beforeId ? positions[beforeId] ?? {x:42,y:90 + Math.max(0,targetIndex)*86} : undefined;
    const targetElement = beforeId === "__start" ? canvasRef.current?.querySelector<HTMLElement>(".start-node") : beforeId ? canvasRef.current?.querySelector<HTMLElement>(`.block-card[data-block-id="${beforeId}"]`) : undefined;
    const insertY = targetPosition ? targetPosition.y + (targetElement?.offsetHeight ?? 88) - 1 : dropPoint?.y ?? 90 + blocks.length*95;
    const blockHeight = kind === "if" || kind === "repeat" ? 90 : kind === "compare" ? 42 : kind === "add" || kind === "true" || kind === "false" || kind === "get" ? 38 : 42;
    setPositions(current => {
      const next = {...current,[block.id]:beforeId && targetPosition ? {x:targetPosition.x,y:insertY} : dropPoint ?? {x:42 + Math.max(0,(rect?.width ?? 700)*0.06),y:insertY}};
      if (beforeId && targetPosition) {
        const targetHeight = targetElement?.offsetHeight ?? 88;
        const shiftFrom = targetPosition.y + targetHeight - 10;
        blocks.forEach((item,index) => {
          if (item.id === beforeId) return;
          const point = current[item.id] ?? {x:42,y:90 + index * 86};
          next[item.id] = point.y >= shiftFrom ? {x:point.x,y:point.y+blockHeight-1} : point;
        });
      }
      return next;
    });
    setBlocks(current => {
      if (!beforeId) return [...current, block];
      if (beforeId === "__start") {
        const reparented = current.map(item => item.attachedTo === "__start" ? { ...item, attachedTo: block.id } : item);
        return [block, ...reparented];
      }
      const index = current.findIndex(item => item.id === beforeId);
      if (index < 0) return [...current, block];
      const reparented = current.map(item => item.attachedTo === beforeId ? { ...item, attachedTo: block.id } : item);
      return [...reparented.slice(0, index + 1), block, ...reparented.slice(index + 1)];
    });
    setSelected([block.id]); setStatus("idle");
  }

  function renderValueSlot(owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) {
    return (
      <ValueSlot
        owner={owner}
        field={field}
        value={value}
        ariaLabel={ariaLabel}
        updateBlock={updateBlock}
        onDrop={onDrop}
        onDragStart={(event, id) => onDragStart(event, { source: "canvas", ids: [id] })}
        renderValueSlot={renderValueSlot}
      />
    );
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
    event.dataTransfer.effectAllowed = payload.source === "library" ? "copy" : "move";
    event.dataTransfer.setData("application/x-blorrl", JSON.stringify(payload));
    if (payload.source === "library") {
      setLibraryDragKind(payload.kind);
      snapGhostRef.current = null;
      setSnapGhost(null);
    } else {
      setLibraryDragKind(null);
    }
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
    const target = canvas ? Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).filter(el => !drag.ids.includes(el.dataset.blockId ?? "")).map(el => {
      const targetId=el.dataset.blockId!; const p=next[targetId] ?? {x:42,y:104}; const r=el.getBoundingClientRect();
      return {id:targetId,p,dist:Math.hypot(event.clientX-(r.left+r.width/2),event.clientY-r.bottom),below:event.clientY>=r.bottom-10};
    }).filter(item=>item.below&&item.dist<70).sort((a,b)=>a.dist-b.dist)[0] : undefined;
    const startNode = canvas?.querySelector<HTMLElement>(".start-node");
    const startRect = startNode?.getBoundingClientRect();
    const startTarget = startRect ? {id:"__start",p:{x:startNode!.offsetLeft,y:startNode!.offsetTop},dist:Math.hypot(event.clientX-(startRect.left+startRect.width/2),event.clientY-startRect.bottom)} : undefined;
    const snapToStart = startTarget && startTarget.dist < 70 && (!target || startTarget.dist < target.dist);
    const snapped = snapToStart ? startTarget : target;
    if (snapped) {
      setBlocks(current => {
        const moving=allBlocks(current).filter(b=>drag.ids.includes(b.id));
        const rest=removeIds(current,drag.ids);
        const i=snapped.id==="__start" ? -1 : rest.findIndex(b=>b.id===snapped.id);
        const attached=moving.map((block,index)=>({...block,attachedTo:index===0?(snapped.id==="__start"?"__start":snapped.id):moving[index-1]!.id}));
        rest.splice(snapped.id==="__start" ? 0 : i<0 ? rest.length : i+1,0,...attached);
        return rest;
      });
      const targetEl = snapped.id==="__start" ? startNode : canvas?.querySelector<HTMLElement>(`[data-block-id="${snapped.id}"]`);
      let y = snapped.p.y + (targetEl?.offsetHeight ?? 50) - 1;
      drag.ids.forEach(item => { next[item]={x:snapped.p.x,y}; y += (canvas?.querySelector<HTMLElement>(`[data-block-id="${item}"]`)?.offsetHeight ?? 92)-1; });
    } else {
      setBlocks(current => { const moving=allBlocks(current).filter(block=>drag.ids.includes(block.id)); return moving.length ? [...removeIds(current,drag.ids),...moving.map(block=>({...block,attachedTo:undefined}))] : current; });
    }
    setPositions(next);
    setStatus("idle");
  }
  function handleLibraryDragOver(event: DragEvent<HTMLElement>) {
    if (!libraryDragKind || !event.dataTransfer.types.includes("application/x-blorrl")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const canvas = canvasRef.current;
    if (!canvas) return;
    const candidates: Array<{id:string;x:number;y:number;distance:number}> = [];
    const start = canvas.querySelector<HTMLElement>(".start-node");
    if (start) {
      const rect = start.getBoundingClientRect();
      const distance = Math.abs(event.clientY - rect.bottom);
      if (event.clientX >= rect.left - 18 && event.clientX <= rect.right + 18 && distance < 34)
        candidates.push({id:"__start",x:start.offsetLeft,y:start.offsetTop+start.offsetHeight-1,distance});
    }
    Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).filter(element => element.parentElement === canvas).forEach(element => {
      const rect = element.getBoundingClientRect();
      const distance = Math.abs(event.clientY - rect.bottom);
      if (event.clientX >= rect.left - 18 && event.clientX <= rect.right + 18 && distance < 34) {
        const id = element.dataset.blockId;
        if (id) candidates.push({id,x:element.offsetLeft,y:element.offsetTop+element.offsetHeight-1,distance});
      }
    });
    // When the pointer is below the current flow, offer an append target even
    // if it is no longer close enough to a block's bottom edge.
    if (!candidates.length) {
      const canvasRect = canvas.getBoundingClientRect();
      if (event.clientX >= canvasRect.left + 8 && event.clientX <= canvasRect.right - 8) {
        const attached = getStartAttachedBlocks(blocks);
        const last = attached[attached.length - 1];
        const lastElement = last
          ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${last.id}"]`)
          : null;
        const fallback = lastElement ?? start;
        if (fallback && event.clientY >= fallback.getBoundingClientRect().bottom - 2) {
          candidates.push({
            id: lastElement?.dataset.blockId ?? "__start",
            x: fallback.offsetLeft,
            y: fallback.offsetTop + fallback.offsetHeight - 1,
            distance: Math.abs(event.clientY - fallback.getBoundingClientRect().bottom) + 34,
          });
        }
      }
    }
    const nearest = candidates.sort((a,b)=>a.distance-b.distance)[0];
    const nextGhost = nearest ? {x:nearest.x,y:nearest.y,count:1,targetId:"__insert__:"+nearest.id} : null;
    const previous = snapGhostRef.current;
    if (!nextGhost || !previous || previous.targetId !== nextGhost.targetId || previous.x !== nextGhost.x || previous.y !== nextGhost.y) setSnapGhost(nextGhost);
    snapGhostRef.current = nextGhost;
  }
  function onLibraryDragEnd() {
    setLibraryDragKind(null);
    snapGhostRef.current = null;
    setSnapGhost(null);
  }
  function onDrop(event: DragEvent, targetId?: string) {
    event.preventDefault(); event.stopPropagation();
    const insertionTarget = snapGhostRef.current?.targetId.startsWith("__insert__:") ? snapGhostRef.current.targetId.slice("__insert__:".length) : undefined;
    const resolvedTargetId = insertionTarget ?? targetId;
    setLibraryDragKind(null);
    const raw=event.dataTransfer.getData("application/x-blorrl"); if(!raw){snapGhostRef.current=null;setSnapGhost(null);return;}
    try {
      const payload=JSON.parse(raw) as DragPayload;
      const valueTarget = resolvedTargetId?.startsWith("value:") ? resolvedTargetId.slice("value:".length).split(":") : undefined;
      if (valueTarget && valueTarget.length===2) {
        const [ownerId,field]=valueTarget;
        const child=payload.source==="library"?createBlock(payload.kind):allBlocks(blocks).find(b=>payload.ids.includes(b.id));
        if(child&&ownerId&&(field==="valueBlock"||field==="rightBlock")&&["add","compare","true","false","get"].includes(child.kind)) setBlocks(current=>putValue(payload.source==="library"?current:removeIds(current,payload.ids),ownerId,field,{...child,attachedTo:undefined}));
        return;
      }
      const conditionTarget = resolvedTargetId?.startsWith("condition:") ? resolvedTargetId.slice("condition:".length) : undefined;
      if (conditionTarget) {
        if (payload.source === "library") dropCondition(conditionTarget,createBlock(payload.kind));
        else {
          const child = allBlocks(blocks).find(b=>payload.ids.includes(b.id));
          if (child) dropCondition(conditionTarget,child,payload.ids);
        }
        return;
      }
      const reporterKinds = ["add","compare","true","false","get"];
      const movingKinds = payload.source === "library" ? [payload.kind] : allBlocks(blocks).filter(b=>payload.ids.includes(b.id)).map(b=>b.kind);
      const isReporter = movingKinds.some(kind=>reporterKinds.includes(kind));
      const target=resolvedTargetId ? allBlocks(blocks).find(b=>b.id===resolvedTargetId) : undefined;
      const branchTarget=!!resolvedTargetId && allBlocks(blocks).some(b=>b.elseId===resolvedTargetId||(b.elseIf??[]).some(br=>br.id===resolvedTargetId));
      if (!insertionTarget && resolvedTargetId && ((target && (target.kind==="if" || target.kind==="repeat")) || branchTarget)) {
        if(payload.source==="library") insertNested(resolvedTargetId,createBlock(payload.kind));
        else nestBlocks(resolvedTargetId,payload.ids);
      } else {
        const rect=canvasRef.current?.getBoundingClientRect();
        const point=rect&&canvasRef.current?{x:Math.max(12,event.clientX-rect.left+canvasRef.current.scrollLeft-150),y:Math.max(64,event.clientY-rect.top+canvasRef.current.scrollTop-24)}:undefined;
        if (payload.source === "library") {
          addBlock(payload.kind, resolvedTargetId, point);
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
    finally { snapGhostRef.current = null; setSnapGhost(null); }
  }
  function selectBlock(_event: MouseEvent, id: string) {
    setSelected([id]);
  }
  function run() {
    setBusy(true);
    try {
      // Execution always starts from the fixed Start node; loose canvas blocks are editor-only.
      const attachedBlocks = getStartAttachedBlocks(blocks);
      if (!attachedBlocks.length) {
        setOutput("Nothing to run: connect a block to Start first.");
        setStatus("idle");
        return;
      }
      const attachedCompilation = compile(attachedBlocks);
      if (attachedCompilation.errors.length) throw new Error(attachedCompilation.errors.join("\n"));
      const result = runProgram(attachedCompilation, stdin, attachedBlocks);
      setOutput(result.error || result.output || "(no output)");
      setStatus(result.error ? "error" : "ran");
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); setStatus("error"); }
    finally { setBusy(false); }
  }
  async function downloadBuild(target: "assembly" | "exe") {
    setBusy(true);
    try {
      const attachedBlocks = getStartAttachedBlocks(blocks);
      if (!attachedBlocks.length) throw new Error("Nothing to build: connect a block to Start first.");
      const attachedAssembly = compileAssembly(attachedBlocks);
      if (attachedAssembly.errors.length) throw new Error(attachedAssembly.errors.join("\n"));
      const response = await fetch("/server/api/build/" + target, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:attachedAssembly.code})});
      if (!response.ok) throw new Error(await response.text());
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=target==="exe"?"main.exe":"main.s";a.click();URL.revokeObjectURL(url);
      setOutput(target==="exe"?"Windows executable downloaded.":"Windows x64 assembly downloaded.");setStatus("built");
    } catch(error) {setOutput(error instanceof Error?error.message:String(error));setStatus("error");}
    finally {setBusy(false);}
  }

  function saveProject() {
    const project = { format: "blorrl", version: 1, workspace: { blocks, attachments: Object.fromEntries(allBlocks(blocks).map(block => [block.id, block.attachedTo ?? null])), positions, workspaceRatio, sidebarWidth } };
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
      const loadedBlocks = project.workspace.blocks as Block[];
      const attachments = project.workspace.attachments && typeof project.workspace.attachments === "object" ? project.workspace.attachments as Record<string, string | null> : null;
      const normalizedBlocks = loadedBlocks.map((block, index) => ({ ...block, attachedTo: attachments ? (attachments[block.id] ?? undefined) : (typeof block.attachedTo === "string" ? block.attachedTo : (index === 0 ? "__start" : loadedBlocks[index - 1]?.id)) }));
      setBlocks(normalizedBlocks); setPositions(loadedPositions);
      setSelected(normalizedBlocks[0] ? [normalizedBlocks[0].id] : []);
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
        <BlockLibrary query={query} onQueryChange={setQuery} onDragStart={(event,kind)=>onDragStart(event,{source:"library",kind})} onDragEnd={onLibraryDragEnd} onAddBlock={addBlock} />
      </aside>
      <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" title="Drag to resize sidebar" onPointerDown={e=>{e.preventDefault();sidebarResizeOrigin.current={x:e.clientX,width:sidebarWidth};document.body.classList.add("resizing-sidebar");}}><span/></div>
      <section className="editor">
        <div className="tabbar"><div className="editor-tab"><span className="tab-file-icon">B</span>main.blorr<span className="tab-unsaved"/></div><div className="tabbar-spacer"/><span className="tab-language">BLORRL</span></div>
        <div className="breadcrumb"><span>main.blorr</span><span>›</span><span>main</span><span className="breadcrumb-right">{totalBlocks} blocks</span></div>
        <div className="pane-heading"><div><span className="pane-eyebrow">VISUAL EDITOR</span><h1>Program flow</h1></div><div className="pane-tools"><span className="saved-indicator"><span/> All changes local</span></div></div>
        {showHelp && <div className="help-panel"><strong>Quick language guide</strong><p>Space + drag or Shift + mouse wheel pans the canvas. Drag blocks to move them. Only one block can be selected at a time. Statement blocks snap into stacks; Calculate, ==, and variable getter blocks go into value sockets. Dragging a statement block carries the blocks connected below it. Delete/Backspace removes selected blocks.</p><code>print "hello";</code></div>}
        <div className={"block-canvas " + (spaceDown ? "space-pan " : "") + (dragPreview ? "dragging-block" : "")} ref={canvasRef} onPointerDown={startCanvasGesture} onPointerMove={moveCanvasGesture} onPointerUp={endCanvasGesture} onPointerCancel={endCanvasGesture} onDragOver={e => { e.preventDefault(); handleLibraryDragOver(e); }} onDragLeave={e => { if (!canvasRef.current?.contains(e.relatedTarget as Node)) { snapGhostRef.current=null; setSnapGhost(null); } }} onDrop={e => onDrop(e)} onWheel={event => { if (event.shiftKey && canvasRef.current) { canvasRef.current.scrollLeft += event.deltaY; event.preventDefault(); } }}>
          <div className="canvas-ruler"><span>PROGRAM ENTRY</span><span>{spaceDown ? "SPACE + DRAG TO PAN" : "DRAG BLOCKS TO MOVE"}</span></div>
          <div className="start-node" style={{left:42,top:38}} onDragOver={handleLibraryDragOver}><span className="start-play"><Play size={13} fill="currentColor"/></span><div><strong>Start</strong><small>Program entry point · fixed</small></div><span className="fixed-pill"><Check size={10}/> FIXED</span></div>
          <div className="flow-stem"><span/></div>
          {dragPreview && dragCanvasExtent > 0 && <div aria-hidden="true" className="drag-extent-preserver" style={{top:dragCanvasExtent-1}} />}
          {blocks.length === 0 && <div className="empty-state"><Blocks size={26}/><strong>Drop a block to begin</strong><span>Drag from the Explorer or click a block on the left.</span></div>}
          {blocks.map((block,index) => <article key={block.id} data-block-id={block.id} data-drop-into={block.kind === "if" || block.kind === "repeat" ? block.id : undefined} style={{left:positions[block.id]?.x ?? 42,top:positions[block.id]?.y ?? (90 + index*86),zIndex:typePanelFor===block.id?30:2,touchAction:"none"}} className={"block-card " + categoryClass(block.kind) + " kind-" + block.kind + (selected.includes(block.id) ? " selected" : "") + (dragPreview && snapGhost && dragPreview.ids.includes(block.id) ? " ghost-source-hidden" : "")} onClickCapture={e => { const target = e.target as HTMLElement; if (target instanceof HTMLInputElement && !blockDragMoved.current) target.focus(); }} onPointerDown={e => {
            if (spaceDown || e.button !== 0 || (e.target as HTMLElement).closest("input,button,select,textarea,.value-chip")) return;
            e.preventDefault();
            e.stopPropagation();
            const selectedIds = [block.id];
            const blockIndex = blocks.findIndex(item => item.id === block.id);
            const reporter = ["add","compare","true","false","get"].includes(block.kind);
            // Only carry the contiguous stack physically attached below this block.
            // A block later in the program list is not automatically part of this stack.
            const connectedStack = (startIndex: number) => {
              const stackIds = [blocks[startIndex]!.id];
              const seen = new Set(stackIds);
              let parentId = blocks[startIndex]!.id;
              // The attachment graph is authoritative; screen coordinates and list adjacency
              // must not decide which blocks are carried by a drag.
              while (true) {
                const child = blocks.find(item =>
                  item.attachedTo === parentId &&
                  !seen.has(item.id) &&
                  !["add","compare","true","false","get"].includes(item.kind)
                );
                if (!child) break;
                stackIds.push(child.id);
                seen.add(child.id);
                parentId = child.id;
              }
              return stackIds;
            };
            const ids = reporter ? [block.id] : connectedStack(blockIndex);
            if (!selected.includes(block.id)) setSelected(selectedIds);
            const origins: Record<string,{x:number;y:number}> = {};
            ids.forEach(id => { origins[id] = positionsRef.current[id] ?? {x:42,y:90 + blocks.findIndex(item=>item.id===id)*86}; });
            setDragCanvasExtent(canvasRef.current?.scrollHeight ?? 0);
            setDragPreview({ids});
            blockPointerDrag.current = {pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,ids,origins};
            snapGhostRef.current = null;
            setSnapGhost(null);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }} onClick={e => selectBlock(e,block.id)} onDragOver={e => {e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("drop-target");handleLibraryDragOver(e);}} onDragLeave={e => e.currentTarget.classList.remove("drop-target")} onDrop={e => {e.currentTarget.classList.remove("drop-target");onDrop(e,block.id);}}>
              <div className="block-gutter"><GripVertical size={14}/><span>{String(index+1).padStart(2,"0")}</span></div>
              <div className="block-content"><div className="block-type"><span className={"type-icon " + categoryClass(block.kind) + " " + block.kind}><Blocks size={13}/></span><strong>{catalog.find(c=>c.kind===block.kind)?.label ?? block.kind}</strong><span className="block-kind">{block.kind.toUpperCase()}</span></div>
                <div className="block-fields">
                  {block.kind === "let" && <VariableBlock block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} typePanelOpen={typePanelFor === block.id} onToggleTypePanel={() => setTypePanelFor(typePanelFor === block.id ? null : block.id)} onUpdateType={updateType} />}
                  {block.kind === "input" && <InputBlock block={block} updateBlock={updateBlock} typePanelOpen={typePanelFor === block.id} onToggleTypePanel={() => setTypePanelFor(typePanelFor === block.id ? null : block.id)} onUpdateType={updateType} />}
                  {block.kind === "print" && <PrintBlock block={block} renderValueSlot={renderValueSlot} />}
                  {block.kind === "get" && <ReporterContent block={block} updateBlock={updateBlock} />}
                  {block.kind === "add" && <Calculate block={block} renderValueSlot={renderValueSlot} updateBlock={updateBlock} />}
                  {block.kind === "compare" && <Compare block={block} renderValueSlot={renderValueSlot} updateBlock={updateBlock} />}
                  {block.kind === "if" && <IfConditionField block={block} updateBlock={updateBlock} renderValueSlot={renderValueSlot} onDrop={onDrop} />}
                  {block.kind === "repeat" && <RepeatBlock block={block} renderValueSlot={renderValueSlot} />}
                  
                  {(block.kind === "true" || block.kind === "false") && <span className="field-hint">{block.kind === "true" ? "Always true" : "Always false"}</span>}
                </div>
                {(block.kind === "if" || block.kind === "repeat") && <ControlBlockBody block={block} selected={selected} onDrop={onDrop} onSelectBlock={(event, id) => selectBlock(event as unknown as MouseEvent, id)} onDragStart={(event, ids) => onDragStart(event, {source:"canvas", ids})} onBlockDragEnd={onBlockDragEnd} updateBlock={updateBlock} updateBranch={updateBranch} addElseIf={addElseIf} toggleElse={toggleElse} />}
              </div>
            </article>)}
          {snapGhost && <div ref={snapGhostContentRef} className={"snap-ghost snap-ghost-stack" + (snapGhost.targetId.startsWith("__value__:") ? " value-snap-ghost" : "")} style={{left:snapGhost.x,top:snapGhost.y}} aria-hidden="true" />}
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
