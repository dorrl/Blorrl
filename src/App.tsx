import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
import { allBlocks, getStartAttachedBlocks, normalizeBlockGraph, putCondition, putValue, removeIds } from "./editor/blockTree";
import { createBlock, updateBlockTree } from "./editor/blockOperations";
import { validateBlockGraph } from "./editor/blockGraphValidation";
import { useCanvasPan } from "./editor/useCanvasPan";

type DragPayload = { source: "canvas"; ids: string[] } | { source: "library"; kind: BlockKind };
type BlockPointerDrag = { pointerId: number; startX: number; startY: number; ids: string[]; origins: Record<string, { x: number; y: number }> };
type SnapGhost = { x: number; y: number; count: number; targetId: string };
function categoryClass(kind: BlockKind) { return "category-" + (catalog.find(item => item.kind === kind)?.category ?? "Values").toLowerCase(); }

function reflowAttachedStack(items: Block[], current: Record<string, { x: number; y: number }>, canvas: HTMLDivElement | null): Record<string, { x: number; y: number }> {
  if (!canvas) return current;
  const next = { ...current };
  const nodes = items.filter(block => block.attachmentType !== "value" && block.attachmentType !== "condition");
  const byId = new Map(nodes.map(block => [block.id, block]));
  const start = canvas.querySelector<HTMLElement>(".start-node");
  const startPoint = start ? { x: start.offsetLeft, y: start.offsetTop + start.offsetHeight - 1 } : { x: 42, y: 90 };
  const visited = new Set<string>();
  const layout = (block: Block): { x: number; y: number } | undefined => {
    if (visited.has(block.id)) return next[block.id];
    visited.add(block.id);
    const parentId = block.attachedTo;
    if (!parentId || parentId === block.id) return next[block.id];
    if (parentId === "__start") { next[block.id] = startPoint; return startPoint; }
    const parent = byId.get(parentId);
    const parentPoint = parent ? layout(parent) : undefined;
    if (!parentPoint) return next[block.id];
    const parentElement = canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${parentId}"]`);
    next[block.id] = { x: parentPoint.x, y: parentPoint.y + Math.max(1, parentElement?.offsetHeight ?? 0) - 1 };
    return next[block.id];
  };
  for (const block of nodes) layout(block);
  return next;
}

const reporterKinds = new Set<BlockKind>(["add", "compare", "true", "false", "get"]);

function isStackBlock(block: Block): boolean {
  return block.attachmentType !== "value" && block.attachmentType !== "condition" && !reporterKinds.has(block.kind);
}

/**
 * Apply an Entry-style next-connection operation to the flat canvas graph.
 * The dragged thread is moved as one unit and the target's old successor is
 * reconnected to the incoming thread's tail.
 */
function connectStackAfter(items: Block[], movingIds: string[], targetId: string): Block[] {
  const movingSet = new Set(movingIds);
  if (!movingIds.length || movingIds.includes(targetId)) return items;

  // Nested control-body blocks are stored inside their owner, while canvas
  // blocks are stored at the root. Read from the canonical graph, then remove
  // the whole moving thread from either location before reconnecting it.
  const flat = allBlocks(items);
  const moving = movingIds
    .map(id => flat.find(block => block.id === id))
    .filter((block): block is Block => !!block);
  if (!moving.length || moving.length !== movingIds.length || moving.some(block => !isStackBlock(block))) return items;

  let rest = removeIds(items, movingIds);
  const parentId = targetId === "__start" ? "__start" : targetId;
  if (parentId !== "__start" && !rest.some(block => block.id === parentId)) return items;

  // Reconnect the previous next block before attaching the incoming thread.
  const successor = allBlocks(rest).find(block => block.attachedTo === parentId && isStackBlock(block));
  if (successor) {
    rest = updateBlockTree(rest, successor.id, {
      attachedTo: moving[moving.length - 1]!.id,
      attachmentType: "stack",
      attachmentField: undefined,
    });
  }

  const attached = moving.map((block, index) => ({
    ...block,
    attachedTo: index === 0 ? parentId : moving[index - 1]!.id,
    attachmentType: "stack" as const,
    attachmentField: undefined,
  }));
  const insertionIndex = parentId === "__start" ? 0 : rest.findIndex(block => block.id === parentId) + 1;
  if (parentId !== "__start" && insertionIndex === 0) return items;
  rest.splice(insertionIndex, 0, ...attached);
  // Reject malformed proposals atomically; the current graph remains untouched.
  return validateBlockGraph(rest).valid ? rest : items;
}

/** EntryJS-style stack connection: only the actual successor thread moves on insertion. */
function getAttachedSuccessorIds(items: Block[], parentId: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let currentParent = parentId;
  while (true) {
    const next = items.find(block => block.attachedTo === currentParent && block.attachmentType !== "value" && block.attachmentType !== "condition" && !visited.has(block.id));
    if (!next) break;
    result.push(next.id);
    visited.add(next.id);
    currentParent = next.id;
  }
  return result;
}

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
const [positions, setPositions] = useState<Record<string,{x:number;y:number}>>({ init1: { "x": 42, "y": 90 }, init2: { x: 42, y: 130 }});
  const [workspaceRatio, setWorkspaceRatio] = useState(68);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 220;
    try {
      const saved = Number(window.localStorage.getItem("blorrl.sidebarWidth"));
      return Number.isFinite(saved) && saved >= 150 && saved <= 420 ? saved : 220;
    } catch {
      return 220;
    }
  });
  const [spaceDown, setSpaceDown] = useState(false);
  const [typePanelFor, setTypePanelFor] = useState<string | null>(null);
  const dragOrigin = useRef<{x:number;y:number;ids:string[];origins:Record<string,{x:number;y:number}>}|null>(null);
  const socketReporterDropHandled = useRef(false); 
  const blockPointerDrag = useRef<BlockPointerDrag | null>(null);
  const blockDragMoved = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ids:string[]}|null>(null);
  const [libraryDragKind, setLibraryDragKind] = useState<BlockKind | null>(null);
  const libraryDragElementRef = useRef<HTMLElement | null>(null);
  const libraryDragOriginalStyleRef = useRef<string | null>(null);
  const libraryDragKindRef = useRef<BlockKind | null>(null);
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
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const blockHeightsRef = useRef(new Map<string, number>());
  const canvasRef = useRef<HTMLDivElement>(null);
  const { startCanvasGesture, moveCanvasGesture, endCanvasGesture } = useCanvasPan(canvasRef, spaceDown);
  const executableBlocks = useMemo(() => getStartAttachedBlocks(blocks), [blocks]);
  const compiled = useMemo(() => compile(executableBlocks), [executableBlocks]);
  const assemblyCompiled = useMemo(() => compileAssembly(executableBlocks), [executableBlocks]);
  const totalBlocks = allBlocks(blocks).length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const recalculate = () => {
      if (blockPointerDrag.current || libraryDragKindRef.current) return;
      setPositions(current => {
        const next = reflowAttachedStack(blocksRef.current, current, canvas);
        const changed = Object.keys(next).some(id => !current[id] || Math.abs(current[id]!.x-next[id]!.x)>0.5 || Math.abs(current[id]!.y-next[id]!.y)>0.5);
        if (!changed) return current;
        positionsRef.current = next;
        return next;
      });
    };
    recalculate();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.blockId;
        if (id) blockHeightsRef.current.set(id, element.getBoundingClientRect().height);
      }
      recalculate();
    });
    canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]").forEach(element => {
      const id = element.dataset.blockId;
      if (id) blockHeightsRef.current.set(id, element.getBoundingClientRect().height);
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [blocks]);

  useEffect(() => {
    try {
      window.localStorage.setItem("blorrl.sidebarWidth", String(sidebarWidth));
    } catch {
      // The editor still works if storage is disabled or full.
    }
  }, [sidebarWidth]);

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
    // The graph does not change during a drag. Cache validation per target so
    // pointer movement within the same snap zone does not rebuild/validate the
    // same candidate graph on every animation frame.
    let lastValidationGraph: Block[] | null = null;
    let lastValidationKey = "";
    let lastValidationResult = false;

    const handleBlockPointerMove = (event: PointerEvent) => {
      const drag = blockPointerDrag.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas || event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 3) blockDragMoved.current = true;
      insertionPreviewElementsRef.current.forEach(element => { element.style.transform = ""; element.style.willChange = ""; });
      insertionPreviewElementsRef.current = [];

      const movingElement = drag.ids.length ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${drag.ids[0]}"]`) : null;

      const canvasRect = canvas.getBoundingClientRect();
      // Snap hit-testing follows the pointer itself, not the dragged block's bounds.
      const pointerX = event.clientX;
      const pointerY = event.clientY;
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
            distance: Math.abs(pointerY - rect.bottom),
            horizontal: pointerX >= rect.left - 6 && pointerX <= rect.right + 6
          } : null;
        })
        .filter((item): item is { id: string; x: number; y: number; distance: number; horizontal: boolean } => item !== null && item.distance < 20 && item.horizontal)
        .sort((a, b) => a.distance - b.distance)[0];

      const startNode = canvas.querySelector<HTMLElement>(".start-node");
      const startRect = startNode?.getBoundingClientRect();
      const startCandidate = !isLooseReporterDrag && startNode && startRect ? {
        id: "__start",
        x: startNode.offsetLeft,
        y: startNode.offsetTop + startNode.offsetHeight - 1,
        distance: Math.abs(pointerY - startRect.bottom),
        horizontal: pointerX >= startRect.left - 6 && pointerX <= startRect.right + 6
      } : null;
      const movingElementForSocket = drag.ids.length === 1 ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${drag.ids[0]}"]`) : null;
      const canBeCondition = !!movingElementForSocket && ["kind-true","kind-false","kind-compare"].some(kind => movingElementForSocket.classList.contains(kind));
      const canBeValue = !!movingElementForSocket && ["kind-add","kind-compare","kind-true","kind-false","kind-get"].some(kind=>movingElementForSocket.classList.contains(kind));
      const valueCandidate = canBeValue ? Array.from(canvas.querySelectorAll<HTMLElement>(".value-slot[data-value-for][data-value-field]"))
        .map(slot => {
          const rect = slot.getBoundingClientRect();
          const inside = event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
          const ownerId = slot.dataset.valueFor;
          const owner = ownerId ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${ownerId}"]`) : null;
          if (!inside || !owner || !ownerId) return null;
          // Anchor the preview at the owner, not at the socket. The ghost is
          // the owner with the incoming reporter inserted, so DOM intrinsic
          // sizing can expand the whole parent before the drop is committed.
          return {
            id: "__value__:" + ownerId + ":" + slot.dataset.valueField,
            x: owner.offsetLeft,
            y: owner.offsetTop,
            distance: 0,
            horizontal: true,
            area: rect.width * rect.height,
          };
        })
        .filter((item): item is {id:string;x:number;y:number;distance:number;horizontal:boolean;area:number} => item !== null)
        .sort((a,b) => a.area-b.area)[0] ?? null : null;
      const conditionCandidate = canBeCondition ? Array.from(canvas.querySelectorAll<HTMLElement>(".condition-slot[data-condition-for]"))
        .map(slot => {
          const rect = slot.getBoundingClientRect();
          const inside = event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
          const ownerId = slot.dataset.conditionFor;
          const owner = ownerId ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${ownerId}"]`) : null;
          return inside && ownerId && owner ? {id:"__condition__:"+ownerId,x:owner.offsetLeft,y:owner.offsetTop,distance:0,horizontal:true} : null;
        }).find(item => item !== null) ?? null : null;
      const snap = valueCandidate ?? conditionCandidate ?? (startCandidate && startCandidate.distance < 20 && startCandidate.horizontal && (!candidate || startCandidate.distance < candidate.distance)
        ? startCandidate
        : candidate);
      const graphBeforeDrop = blocksRef.current;
      const validationKey = snap ? `${drag.ids.join(",")}|${snap.id}` : "";
      let connectionValid = false;
      if (lastValidationGraph === graphBeforeDrop && lastValidationKey === validationKey) {
        connectionValid = lastValidationResult;
      } else {
        const draggedBlock = allBlocks(graphBeforeDrop).find(block => drag.ids.includes(block.id));
        if (snap?.id.startsWith("__value__:")) {
          const [, ownerId, field] = snap.id.split(":");
          if (draggedBlock && ownerId && (field === "valueBlock" || field === "rightBlock")) {
            const proposed = putValue(graphBeforeDrop, ownerId, field, draggedBlock);
            connectionValid = allBlocks(proposed).some(block =>
              block.id === draggedBlock.id && block.attachedTo === ownerId &&
              block.attachmentType === "value" && block.attachmentField === field
            );
          }
        } else if (snap?.id.startsWith("__condition__:")) {
          const ownerId = snap.id.slice("__condition__:".length);
          if (draggedBlock && ownerId) {
            const proposed = putCondition(graphBeforeDrop, ownerId, draggedBlock);
            connectionValid = allBlocks(proposed).some(block =>
              block.id === draggedBlock.id && block.attachedTo === ownerId &&
              block.attachmentType === "condition" && block.attachmentField === "conditionBlock"
            );
          }
        } else if (snap) {
          connectionValid = connectStackAfter(graphBeforeDrop, drag.ids, snap.id) !== graphBeforeDrop;
        }
        lastValidationGraph = graphBeforeDrop;
        lastValidationKey = validationKey;
        lastValidationResult = connectionValid;
      }
      const ghost = snap && connectionValid
        ? { x: snap.x, y: snap.y, count: drag.ids.length, targetId: snap.id }
        : null;
      // During stack insertion, shift existing blocks below the target down by
      // the incoming stack's height so the preview matches the resulting layout.
      // These are the original elements; no placeholder or clone is created.
      if (ghost && !ghost.targetId.startsWith("__value__:") && !ghost.targetId.startsWith("__condition__:")) {
        const insertedHeight = drag.ids.reduce((total, id) =>
          total + (canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1, 0);
        const successorIds = new Set(getAttachedSuccessorIds(
          blocksRef.current,
          ghost.targetId === "__start" ? "__start" : ghost.targetId,
        ));
        Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).forEach(element => {
          const id = element.dataset.blockId;
          if (!id || drag.ids.includes(id) || !successorIds.has(id)) return;
          element.style.willChange = "transform";
          element.style.transform = `translate(0px, ${insertedHeight}px)`;
          insertionPreviewElementsRef.current.push(element);
        });
      }
      // While a valid connection is predicted, temporarily pin the dragged
      // original block(s) to the predicted final layout and fade them slightly.
      // No placeholder or cloned preview element is created.
      drag.ids.forEach((id, index) => {
        const element = canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`);
        if (!element) return;
        element.style.willChange = "transform, opacity";
        // Keep the dragged source under the pointer. The separate ghost below
        // previews the magnetic connection position, as EntryJS separates the
        // moving BlockView from its connection/magnet feedback.
        element.style.transform = `translate(${dx}px, ${dy}px)`;
        // The cloned preview is the only visible representation during a drag.
        // Hiding the source avoids the pointer-position/socket-position flicker.
        element.style.opacity = ghost ? "0" : "";
      });
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
      drag.ids.forEach(id => { const element = canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`); if (element) { element.style.transform = ""; element.style.opacity = ""; element.style.willChange = ""; } });
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
          return putValue(current,targetId,field,child);
        });
        drag.ids.forEach(id => delete next[id]);
        setSelected(drag.ids.slice(0,1));
      } else if (ghost?.targetId.startsWith("__condition__:")) {
        const targetId = ghost.targetId.slice("__condition__:".length);
        setBlocks(current => {
          const child = allBlocks(current).find(block => drag.ids.includes(block.id));
          if (!child || (child.kind !== "true" && child.kind !== "false" && child.kind !== "compare")) return current;
          return putCondition(current,targetId,child);
        });
        drag.ids.forEach(id => delete next[id]);
        setSelected(drag.ids.slice(0,1));
      } else if (ghost) {
        setBlocks(current => connectStackAfter(current, drag.ids, ghost.targetId));
        // Materialize fallback layout positions before shifting, otherwise blocks
        // without an explicit entry in positions keep their old index-based location.
        blocksRef.current.forEach((block, index) => {
          if (!next[block.id]) next[block.id] = positionsRef.current[block.id] ?? {x:42,y:90 + index * 86};
        });
        const insertedHeight = drag.ids.reduce((total, id) =>
          total + (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1, 0);
        const successorIds = new Set(getAttachedSuccessorIds(
          blocksRef.current,
          ghost.targetId === "__start" ? "__start" : ghost.targetId,
        ));
        // Make room for the inserted thread without moving unrelated floating blocks.
        Object.entries(next).forEach(([id, point]) => {
          if (!drag.ids.includes(id) && successorIds.has(id)) {
            next[id] = { ...point, y: point.y + insertedHeight };
          }
        });
        let y = ghost.y;
        drag.ids.forEach(id => {
          next[id] = {x:ghost.x,y};
          y += (canvas?.querySelector<HTMLElement>(`.block-card[data-block-id="${id}"]`)?.offsetHeight ?? 38) - 1;
        });
      } else {
        const movingReporter = allBlocks(blocksRef.current).find(block => drag.ids.includes(block.id) && reporterKinds.has(block.kind));
        if (movingReporter && canvas) {
          const rect = canvas.getBoundingClientRect();
          const point = {
            x: Math.max(12, event.clientX - rect.left + canvas.scrollLeft - 10),
            y: Math.max(64, event.clientY - rect.top + canvas.scrollTop - 15),
          };
          setBlocks(current => {
            const moving = allBlocks(current).filter(block => drag.ids.includes(block.id));
            return [
              ...removeIds(current, drag.ids),
              ...moving.map(block => ({
                ...block,
                attachedTo: undefined,
                attachmentType: undefined,
                attachmentField: undefined,
              })),
            ];
          });
          drag.ids.forEach(id => { next[id] = point; });
        } else {
          drag.ids.forEach(id => {
            const origin = drag.origins[id];
            if (origin) next[id] = {x:Math.max(12,origin.x+dx),y:Math.max(64,origin.y+dy)};
          });
          // Detach only the dragged stack root; its descendants remain connected to each other.
          const rootId = drag.ids[0];
          setBlocks(current => current.map(block => block.id === rootId
            ? ({ ...block, attachedTo: undefined, attachmentType: undefined, attachmentField: undefined })
            : block));
        }
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
    const canvas = canvasRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!snapGhost || !canvas) return;

    const findBlock = (id: string) => Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).find(el => el.dataset.blockId === id) ?? null;
    const sourceFor = (id: string) => libraryDragKind ? libraryDragElementRef.current : findBlock(id);
    const clean = <T extends HTMLElement>(el: T): T => {
      el.classList.remove("selected", "ghost-source-hidden", "library-drag-active");
      el.removeAttribute("data-block-id"); el.removeAttribute("data-drop-into");
      el.setAttribute("aria-hidden", "true"); el.setAttribute("inert", "");
      el.querySelectorAll<HTMLElement>("[data-block-id], [data-drop-into]").forEach(node => { node.removeAttribute("data-block-id"); node.removeAttribute("data-drop-into"); });
      el.querySelectorAll(".delete-block").forEach(node => node.remove());
      el.querySelectorAll<HTMLElement>("input,button,select,textarea").forEach(node => { node.setAttribute("disabled", ""); node.setAttribute("tabindex", "-1"); });
      return el;
    };
    const layoutRoot = <T extends HTMLElement>(el: T): T => {
      clean(el);
      Object.assign(el.style, {position:"relative",left:"auto",top:"auto",right:"auto",bottom:"auto",transform:"none",zIndex:"auto",margin:"0",pointerEvents:"none"});
      return el;
    };
    const valueChip = (source: HTMLElement, kind: BlockKind) => {
      const fields = source.querySelector<HTMLElement>(".block-fields");
      if (!fields) return null;
      const chip = document.createElement("span");
      chip.className = "block-card value-block-model value-chip " + categoryClass(kind) + " kind-" + kind;
      const content = document.createElement("span"); content.className = "block-content";
      const clonedFields = fields.cloneNode(true) as HTMLElement; clonedFields.className = "block-fields";
      content.append(clean(clonedFields)); chip.append(content);
      return layoutRoot(chip);
    };

    const valueSocket = snapGhost.targetId.startsWith("__value__:");
    const conditionSocket = snapGhost.targetId.startsWith("__condition__:");
    if (valueSocket || conditionSocket) {
      const [, ownerId, field] = snapGhost.targetId.split(":");
      const owner = ownerId ? findBlock(ownerId) : null;
      const source = sourceFor(dragPreview?.ids.length === 1 ? dragPreview.ids[0]! : "");
      if (!owner || !source) return;
      const ownerClone = layoutRoot(owner.cloneNode(true) as HTMLElement);
      const kind = libraryDragKind ?? (source.className.match(/\bkind-([\w-]+)/)?.[1] as BlockKind | undefined);
      if (!kind) return;
      if (valueSocket) {
        if (field !== "valueBlock" && field !== "rightBlock") return;
        const slot = Array.from(ownerClone.querySelectorAll<HTMLElement>(".value-slot[data-value-for][data-value-field]")).find(el => el.dataset.valueFor === ownerId && el.dataset.valueField === field);
        const chip = valueChip(source, kind);
        if (!slot || !chip) return;
        slot.replaceChildren(chip);
      } else {
        const slot = ownerClone.querySelector<HTMLElement>(".condition-slot[data-condition-for]");
        if (!slot) return;
        if (kind === "true" || kind === "false") slot.replaceChildren(document.createTextNode(kind === "true" ? "True" : "False"));
        else if (kind === "compare") {
          const fields = source.querySelector<HTMLElement>(".inline-operator-fields");
          if (!fields) return;
          slot.replaceChildren(clean(fields.cloneNode(true) as HTMLElement));
        } else return;
      }
      container.append(ownerClone);
      return;
    }
    if (!dragPreview) return;
    dragPreview.ids.forEach((id,index) => {
      const source = findBlock(id);
      if (!source) return;
      const clone = layoutRoot(source.cloneNode(true) as HTMLElement);
      if (index) clone.style.marginTop = "-1px";
      container.append(clone);
    });
  }, [snapGhost?.targetId, snapGhost?.x, snapGhost?.y, dragPreview?.ids.join(","), libraryDragKind]);
  function startReporterPointerDrag(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (spaceDown || event.button !== 0 || (event.target as HTMLElement).closest("input,button,select,textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const source = event.currentTarget;
    const canvasRect = canvas.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const point = {
      x: sourceRect.left - canvasRect.left + canvas.scrollLeft,
      y: sourceRect.top - canvasRect.top + canvas.scrollTop,
    };
    const ids = [id];
    setSelected(ids);
    setDragCanvasExtent(canvas.scrollHeight);
    setDragPreview({ ids });
    blockDragMoved.current = false;
    blockPointerDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ids,
      origins: { [id]: point },
    };
    snapGhostRef.current = null;
    setSnapGhost(null);
    source.setPointerCapture(event.pointerId);
  }

  function renderValueSlot(owner: Block, field: "valueBlock" | "rightBlock", value: string, ariaLabel: string) {
    return (
      <ValueSlot
        owner={owner}
        field={field}
        nestedBlock={blocks.find(block => block.attachedTo === owner.id && block.attachmentType === "value" && block.attachmentField === field)}
        value={value}
        ariaLabel={ariaLabel}
        updateBlock={updateBlock}
        onDrop={onDrop}
        onReporterPointerDown={startReporterPointerDrag}
        renderValueSlot={renderValueSlot}
      />
    );
  }
  function dropCondition(targetId: string, child: Block, movingIds: string[] = []) {
    if (child.kind !== "true" && child.kind !== "false" && child.kind !== "compare") return;
    setBlocks(current => {
      const source = allBlocks(current).find(b => b.id === child.id) ?? child;
      return putCondition(current,targetId,source);
    });
    if (movingIds.length) setPositions(current => { const next = {...current}; movingIds.forEach(id => delete next[id]); return next; });
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
  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks(current => updateBlockTree(current, id, patch));
    setStatus("idle");
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
  function addBlock(kind: BlockKind, targetId?: string, point?: { x: number; y: number }) {
    const block = createBlock(kind);
    const isReporter = reporterKinds.has(kind);
    const target = targetId ? allBlocks(blocksRef.current).find(item => item.id === targetId) : undefined;

    if (!isReporter && targetId && target && (target.kind === "if" || target.kind === "repeat")) {
      insertNested(targetId, block);
      if (point) setPositions(current => ({ ...current, [block.id]: point }));
      return;
    }

    setBlocks(current => {
      const next = [...current, block];
      if (!isReporter && targetId && (targetId === "__start" || allBlocks(current).some(item => item.id === targetId))) {
        return connectStackAfter(next, [block.id], targetId);
      }
      return next;
    });
    if (point) {
      setPositions(current => ({ ...current, [block.id]: point }));
    } else if (!targetId || isReporter) {
      setPositions(current => ({ ...current, [block.id]: { x: 42, y: 90 + allBlocks(blocksRef.current).length * 12 } }));
    }
    setSelected([block.id]);
    setStatus("idle");
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
    // Some browsers require a plain-text payload before they initiate native drag.
    event.dataTransfer.setData("text/plain", payload.source === "library" ? payload.kind : payload.ids.join(","));
    if (payload.source === "library") {
      // Hide the browser's native drag bitmap; the actual palette element is moved below.
      const dragImage = document.createElement("div");
      dragImage.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0";
      document.body.appendChild(dragImage);
      event.dataTransfer.setDragImage(dragImage, 0, 0);
      requestAnimationFrame(() => dragImage.remove());
      // Move the existing palette block itself; do not create a duplicate preview.
      const source = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(".library-block-preview");
      if (source) {
        libraryDragElementRef.current = source;
        libraryDragOriginalStyleRef.current = source.getAttribute("style");
        // Do not relocate the native drag source synchronously inside dragstart:
        // Chromium can cancel the drag if its source is reparented/restyled immediately.
        const rect = source.getBoundingClientRect();
        requestAnimationFrame(() => {
          if (libraryDragElementRef.current !== source) return;
          Object.assign(source.style, {
            position: "fixed", left: String(rect.left) + "px", top: String(rect.top) + "px",
            width: String(rect.width) + "px", maxWidth: "none", margin: "0", zIndex: "1000", opacity: ".58",
            pointerEvents: "none", transform: "none",
          });
          source.classList.add("library-drag-active");
        });
      }
      libraryDragKindRef.current = payload.kind;
      setLibraryDragKind(payload.kind);
      snapGhostRef.current = null;
      setSnapGhost(null);
    } else {
      libraryDragKindRef.current = null;
      setLibraryDragKind(null);
      restoreLibraryDragElement();
    }
    if (payload.source === "canvas") {
      socketReporterDropHandled.current = false;
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
    if (socketReporterDropHandled.current) {
      socketReporterDropHandled.current = false;
      return;
    }
    // Native drag is used for socket reporters. If they are released outside a
    // socket, explicitly detach them and place them at the pointer instead of
    // leaving the attachment metadata behind.
    if ((event.target as HTMLElement).closest(".value-chip")) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: Math.max(12, event.clientX - rect.left + canvas.scrollLeft - 10),
        y: Math.max(64, event.clientY - rect.top + canvas.scrollTop - 15),
      };
      // Socket reporters are separate graph nodes, not fields on the owner.
      // Remove the old attachment and promote the same node to a free block.
      setBlocks(current => {
        const moving = allBlocks(current).filter(block => drag.ids.includes(block.id));
        if (!moving.length) return current;
        const rest = removeIds(current, drag.ids);
        return [
          ...rest,
          ...moving.map(block => ({
            ...block,
            attachedTo: undefined,
            attachmentType: undefined,
            attachmentField: undefined,
          })),
        ];
      });
      setPositions(current => {
        const next = { ...current };
        drag.ids.forEach(id => { next[id] = point; });
        return next;
      });
      setSnapGhost(null);
      snapGhostRef.current = null;
      setStatus("idle");
      return;
    }
    // Reporters are values, not statement-stack connections. If a native
    // drag ends outside a compatible socket, promote the reporter to a loose
    // canvas block rather than snapping it onto a statement thread.
    const draggedBlocks = allBlocks(blocks).filter(block => drag.ids.includes(block.id));
    if (draggedBlocks.some(block => reporterKinds.has(block.kind))) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: Math.max(12, event.clientX - rect.left + canvas.scrollLeft - 10),
        y: Math.max(64, event.clientY - rect.top + canvas.scrollTop - 15),
      };
      setBlocks(current => {
        const moving = allBlocks(current).filter(block => drag.ids.includes(block.id));
        return [
          ...removeIds(current, drag.ids),
          ...moving.map(block => ({
            ...block,
            attachedTo: undefined,
            attachmentType: undefined,
            attachmentField: undefined,
          })),
        ];
      });
      setPositions(current => {
        const next = { ...current };
        drag.ids.forEach(id => { next[id] = point; });
        return next;
      });
      setSnapGhost(null);
      snapGhostRef.current = null;
      setStatus("idle");
      return;
    }

    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const next: Record<string,{x:number;y:number}> = {...positionsRef.current};
    drag.ids.forEach(item => { const p=drag.origins[item]; next[item]={x:Math.max(12,p.x+dx),y:Math.max(64,p.y+dy)}; });
    const canvas = canvasRef.current;
    const target = canvas ? Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).filter(el =>
      el.parentElement === canvas &&
      !drag.ids.includes(el.dataset.blockId ?? "") &&
      !Array.from(reporterKinds).some(kind => el.classList.contains("kind-" + kind))
    ).map(el => {
      const targetId=el.dataset.blockId!; const p=next[targetId] ?? {x:42,y:104}; const r=el.getBoundingClientRect();
      return {id:targetId,p,dist:Math.hypot(event.clientX-(r.left+r.width/2),event.clientY-r.bottom),below:event.clientY>=r.bottom-10};
    }).filter(item=>item.below&&item.dist<70).sort((a,b)=>a.dist-b.dist)[0] : undefined;
    const startNode = canvas?.querySelector<HTMLElement>(".start-node");
    const startRect = startNode?.getBoundingClientRect();
    const startTarget = startRect ? {id:"__start",p:{x:startNode!.offsetLeft,y:startNode!.offsetTop},dist:Math.hypot(event.clientX-(startRect.left+startRect.width/2),event.clientY-startRect.bottom)} : undefined;
    const snapToStart = startTarget && startTarget.dist < 70 && (!target || startTarget.dist < target.dist);
    const snapped = snapToStart ? startTarget : target;
    if (snapped) {
      setBlocks(current => connectStackAfter(current, drag.ids, snapped.id));
      const targetEl = snapped.id==="__start" ? startNode : canvas?.querySelector<HTMLElement>(`[data-block-id="${snapped.id}"]`);
      let y = snapped.p.y + (targetEl?.offsetHeight ?? 50) - 1;
      drag.ids.forEach(item => { next[item]={x:snapped.p.x,y}; y += (canvas?.querySelector<HTMLElement>(`[data-block-id="${item}"]`)?.offsetHeight ?? 92)-1; });
    } else {
      setBlocks(current => { const moving=allBlocks(current).filter(block=>drag.ids.includes(block.id)); return moving.length ? [...removeIds(current,drag.ids),...moving.map(block=>({...block,attachedTo:undefined,attachmentType:undefined,attachmentField:undefined}))] : current; });
    }
    setPositions(next);
    setStatus("idle");
  }
  function restoreLibraryDragElement() {
    const element = libraryDragElementRef.current;
    if (element) {
      element.classList.remove("library-drag-active");
      const originalStyle = libraryDragOriginalStyleRef.current;
      if (originalStyle === null) element.removeAttribute("style");
      else element.setAttribute("style", originalStyle);
    }
    libraryDragElementRef.current = null;
    libraryDragOriginalStyleRef.current = null;
  }
  function handleLibraryDragOver(event: DragEvent<HTMLElement>) {
    const kind = libraryDragKindRef.current;
    if (!kind || !event.dataTransfer.types.includes("application/x-blorrl")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const source = libraryDragElementRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Clear the previous insertion preview before evaluating the new magnet.
    insertionPreviewElementsRef.current.forEach(element => {
      element.style.transform = "";
      element.style.willChange = "";
    });
    insertionPreviewElementsRef.current = [];
    const canvasRect = canvas.getBoundingClientRect();
    // Position the original palette element at the predicted post-drop location.
    // snapGhost remains target metadata only; no extra preview element is rendered.
    const positionOriginalAt = (x: number, y: number) => {
      if (!source) return;
      source.style.opacity = ".58";
      source.style.left = String(canvasRect.left + x - canvas.scrollLeft) + "px";
      source.style.top = String(canvasRect.top + y - canvas.scrollTop) + "px";
    };
    const isValueReporter = ["add", "compare", "true", "false", "get"].includes(kind);
    const isConditionReporter = ["compare", "true", "false"].includes(kind);
    if (isValueReporter) {
      const socket = Array.from(canvas.querySelectorAll<HTMLElement>(".value-slot[data-value-for][data-value-field]"))
        .map(slot => { const rect = slot.getBoundingClientRect(); const inside = event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4; const ownerId = slot.dataset.valueFor; const owner = ownerId ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${ownerId}"]`) : null; return inside && ownerId && owner ? {id:`__value__:${ownerId}:${slot.dataset.valueField}`,x:owner.offsetLeft,y:owner.offsetTop,area:rect.width*rect.height} : null; })
        .filter((item): item is {id:string;x:number;y:number;area:number} => item !== null).sort((a,b)=>a.area-b.area)[0];
      if (socket) { const ghost = {...socket,count:1,targetId:socket.id}; if (source) source.style.opacity = "0"; if (snapGhostRef.current?.targetId !== ghost.targetId || snapGhostRef.current.x !== ghost.x || snapGhostRef.current.y !== ghost.y) setSnapGhost(ghost); snapGhostRef.current = ghost; return; }
    }
    if (isConditionReporter) {
      const socket = Array.from(canvas.querySelectorAll<HTMLElement>(".condition-slot[data-condition-for]"))
        .map(slot => { const rect = slot.getBoundingClientRect(); const inside = event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4; const ownerId = slot.dataset.conditionFor; const owner = ownerId ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${ownerId}"]`) : null; return inside && ownerId && owner ? {id:`__condition__:${ownerId}`,x:owner.offsetLeft,y:owner.offsetTop} : null; })
        .find((item): item is {id:string;x:number;y:number} => item !== null);
      if (socket) { const ghost = {...socket,count:1,targetId:socket.id}; if (source) source.style.opacity = "0"; if (snapGhostRef.current?.targetId !== ghost.targetId || snapGhostRef.current.x !== ghost.x || snapGhostRef.current.y !== ghost.y) setSnapGhost(ghost); snapGhostRef.current = ghost; return; }
    }
    // Keep a real, unscaled block under the pointer even before it reaches a
    // compatible socket. This replaces the browser's native drag screenshot.
    const freeGhost = () => ({
      x: event.clientX - canvasRect.left + canvas.scrollLeft - 10,
      y: event.clientY - canvasRect.top + canvas.scrollTop - 18,
      count: 1,
      targetId: "__free__",
    });
    if (isValueReporter) {
      const ghost = freeGhost();
      positionOriginalAt(ghost.x, ghost.y);
      if (snapGhostRef.current?.targetId !== ghost.targetId || snapGhostRef.current.x !== ghost.x || snapGhostRef.current.y !== ghost.y) setSnapGhost(ghost);
      snapGhostRef.current = ghost;
      return;
    }
    const candidates: Array<{id:string;x:number;y:number;distance:number}> = [];
    const start = canvas.querySelector<HTMLElement>(".start-node");
    if (start) {
      const rect = start.getBoundingClientRect();
      const distance = Math.abs(event.clientY - rect.bottom);
      if (event.clientX >= rect.left - 10 && event.clientX <= rect.right + 10 && distance < 16)
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
    // When the pointer is below the current flow, allow appending only near the final block.
    if (!candidates.length) {
      const canvasRect = canvas.getBoundingClientRect();
      if (event.clientX >= canvasRect.left + 8 && event.clientX <= canvasRect.right - 8) {
        const attached = getStartAttachedBlocks(blocks);
        const last = attached[attached.length - 1];
        const lastElement = last
          ? canvas.querySelector<HTMLElement>(`.block-card[data-block-id="${last.id}"]`)
          : null;
        const fallback = lastElement ?? start;
        if (fallback && event.clientY >= fallback.getBoundingClientRect().bottom - 2 && event.clientY <= fallback.getBoundingClientRect().bottom + 18) {
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
    const nextGhost = nearest ? {x:nearest.x,y:nearest.y,count:1,targetId:"__insert__:"+nearest.id} : freeGhost();
    positionOriginalAt(nextGhost.x, nextGhost.y);
    if (nextGhost.targetId.startsWith("__insert__:")) {
      const targetId = nextGhost.targetId.slice("__insert__:".length);
      const insertedHeight = (source?.getBoundingClientRect().height ?? 38) - 1;
      const successorIds = new Set(getAttachedSuccessorIds(blocksRef.current, targetId));
      Array.from(canvas.querySelectorAll<HTMLElement>(".block-card[data-block-id]")).forEach(element => {
        const id = element.dataset.blockId;
        if (!id || !successorIds.has(id)) return;
        element.style.willChange = "transform";
        element.style.transform = `translate(0px, ${insertedHeight}px)`;
        insertionPreviewElementsRef.current.push(element);
      });
    }
    const previous = snapGhostRef.current;
    if (!previous || previous.targetId !== nextGhost.targetId || previous.x !== nextGhost.x || previous.y !== nextGhost.y) setSnapGhost(nextGhost);
    snapGhostRef.current = nextGhost;
  }
  function onLibraryDragEnd() {
    insertionPreviewElementsRef.current.forEach(element => {
      element.style.transform = "";
      element.style.willChange = "";
    });
    insertionPreviewElementsRef.current = [];
    libraryDragKindRef.current = null;
    setLibraryDragKind(null);
    restoreLibraryDragElement();
    snapGhostRef.current = null;
    setSnapGhost(null);
  }
  function onDrop(event: DragEvent, targetId?: string) {
    event.preventDefault(); event.stopPropagation();
    const ghostTarget = snapGhostRef.current?.targetId;
    const insertionTarget = ghostTarget?.startsWith("__insert__:") ? ghostTarget.slice("__insert__:".length) : undefined;
    const socketTarget = ghostTarget?.startsWith("__value__:") ? `value:${ghostTarget.slice("__value__:".length)}` : ghostTarget?.startsWith("__condition__:") ? `condition:${ghostTarget.slice("__condition__:".length)}` : undefined;
    // A drop event fired directly by a socket is more reliable than a stale
    // pointer-magnet target left over from the previous drag frame.
    const explicitSocketTarget = targetId?.startsWith("value:") || targetId?.startsWith("condition:") ? targetId : undefined;
    const resolvedTargetId = explicitSocketTarget ?? (ghostTarget === "__free__" ? undefined : insertionTarget ?? socketTarget ?? targetId);
    libraryDragKindRef.current = null;
    setLibraryDragKind(null);
    restoreLibraryDragElement();
    const raw=event.dataTransfer.getData("application/x-blorrl"); if(!raw){snapGhostRef.current=null;setSnapGhost(null);return;}
    try {
      const payload=JSON.parse(raw) as DragPayload;
      const valueTarget = resolvedTargetId?.startsWith("value:") ? resolvedTargetId.slice("value:".length).split(":") : undefined;
      if (valueTarget && valueTarget.length===2) {
        const [ownerId,field]=valueTarget;
        const child=payload.source==="library"?createBlock(payload.kind):allBlocks(blocks).find(b=>payload.ids.includes(b.id));
        if(child&&ownerId&&(field==="valueBlock"||field==="rightBlock")&&["add","compare","true","false","get"].includes(child.kind)) {
          setBlocks(current=>putValue(current,ownerId,field,child));
          if (payload.source === "canvas") socketReporterDropHandled.current = true;
          if (payload.source === "canvas") setPositions(current => { const next = {...current}; payload.ids.forEach(id => delete next[id]); return next; });
          setSelected([child.id]);
          setStatus("idle");
        }
        return;
      }
      const conditionTarget = resolvedTargetId?.startsWith("condition:") ? resolvedTargetId.slice("condition:".length) : undefined;
      if (conditionTarget) {
        if (payload.source === "library") {
          dropCondition(conditionTarget,createBlock(payload.kind));
        } else {
          const child = allBlocks(blocks).find(b=>payload.ids.includes(b.id));
          if (child && ["true", "false", "compare"].includes(child.kind)) {
            // Prevent drag-end from treating a successful condition connection
            // as a loose reporter drop.
            socketReporterDropHandled.current = true;
            dropCondition(conditionTarget,child,payload.ids);
          }
        }
        return;
      }
      const reporterKinds = ["add","compare","true","false","get"];
      const movingKinds = payload.source === "library" ? [payload.kind] : allBlocks(blocks).filter(b=>payload.ids.includes(b.id)).map(b=>b.kind);
      const isReporter = movingKinds.some(kind=>reporterKinds.includes(kind));
      const target=resolvedTargetId ? allBlocks(blocks).find(b=>b.id===resolvedTargetId) : undefined;
      const branchTarget=!!resolvedTargetId && allBlocks(blocks).some(b=>b.elseId===resolvedTargetId||(b.elseIf??[]).some(br=>br.id===resolvedTargetId));
      if (!isReporter && !insertionTarget && resolvedTargetId && ((target && (target.kind==="if" || target.kind==="repeat")) || branchTarget)) {
        if(payload.source==="library") insertNested(resolvedTargetId,createBlock(payload.kind));
        else nestBlocks(resolvedTargetId,payload.ids);
      } else {
        const rect=canvasRef.current?.getBoundingClientRect();
        const point=rect&&canvasRef.current?{x:Math.max(12,event.clientX-rect.left+canvasRef.current.scrollLeft-150),y:Math.max(64,event.clientY-rect.top+canvasRef.current.scrollTop-24)}:undefined;
        if (payload.source === "library") {
          if (isReporter && point) {
            const child = createBlock(payload.kind);
            setBlocks(current => [...current, child]);
            setPositions(current => ({...current,[child.id]:point}));
            setSelected([child.id]);
            setStatus("idle");
          } else addBlock(payload.kind, resolvedTargetId, point);
        } else if (isReporter) {
          const child = allBlocks(blocks).find(b=>payload.ids.includes(b.id));
          if (child && point) {
            setBlocks(current=>[...removeIds(current,payload.ids),{...child,attachedTo:undefined,attachmentType:undefined,attachmentField:undefined}]);
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
      const loadedBlocks = normalizeBlockGraph(project.workspace.blocks as Block[]);
      const attachments = project.workspace.attachments && typeof project.workspace.attachments === "object" ? project.workspace.attachments as Record<string, string | null> : null;
      const normalizedBlocks = loadedBlocks.map((block, index) => ({ ...block, attachedTo: block.attachmentType === "value" || block.attachmentType === "condition" ? block.attachedTo : attachments ? (attachments[block.id] ?? undefined) : (typeof block.attachedTo === "string" ? block.attachedTo : (index === 0 ? "__start" : loadedBlocks[index - 1]?.id)), attachmentType: block.attachmentType ?? (block.attachedTo ? "stack" : undefined) }));
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
          <div className="start-node" style={{left:42,top:38}} onDragOver={handleLibraryDragOver}><span className="start-play"><Play size={13} fill="currentColor"/></span><div><strong>Start</strong><small>Program entry point</small></div><span className="fixed-pill"></span></div>
          <div className="flow-stem"><span/></div>
          {snapGhost && (dragPreview || (libraryDragKind && (snapGhost.targetId.startsWith("__value__:") || snapGhost.targetId.startsWith("__condition__:")))) && <div
            ref={snapGhostContentRef}
            className="snap-ghost-preview"
            aria-hidden="true"
            style={{ left: snapGhost.x, top: snapGhost.y }}
          />}
          {dragPreview && dragCanvasExtent > 0 && <div aria-hidden="true" className="drag-extent-preserver" style={{top:dragCanvasExtent-1}} />}
          {blocks.length === 0 && <div className="empty-state"><Blocks size={26}/><strong>Drop a block to begin</strong><span>Drag from the Explorer or click a block on the left.</span></div>}
          {blocks.filter(block => block.attachmentType !== "value" && block.attachmentType !== "condition").map((block,index) => <article key={block.id} data-block-id={block.id} data-drop-into={block.kind === "if" || block.kind === "repeat" ? block.id : undefined} style={{left:positions[block.id]?.x ?? 42,top:positions[block.id]?.y ?? (90 + index*86),zIndex:typePanelFor===block.id?30:2,touchAction:"none"}} className={"block-card " + categoryClass(block.kind) + " kind-" + block.kind + (["get","true","false","add","compare"].includes(block.kind) ? " value-block-model" : "") + (selected.includes(block.id) ? " selected" : "")} onClickCapture={e => { const target = e.target as HTMLElement; if (target instanceof HTMLInputElement && !blockDragMoved.current) target.focus(); }} onPointerDown={e => {
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
                  {block.kind === "if" && <IfConditionField block={block} conditionBlock={blocks.find(item => item.attachedTo === block.id && item.attachmentType === "condition" && item.attachmentField === "conditionBlock")} updateBlock={updateBlock} renderValueSlot={renderValueSlot} onDrop={onDrop} />}
                  {block.kind === "repeat" && <RepeatBlock block={block} renderValueSlot={renderValueSlot} />}
                  
                  {(block.kind === "true" || block.kind === "false") && <span className="field-hint">{block.kind === "true" ? "Always true" : "Always false"}</span>}
                </div>
                {(block.kind === "if" || block.kind === "repeat") && <ControlBlockBody block={block} selected={selected} onDrop={onDrop} onSelectBlock={(event, id) => selectBlock(event as unknown as MouseEvent, id)} onDragStart={(event, ids) => onDragStart(event, {source:"canvas", ids})} onBlockDragEnd={onBlockDragEnd} updateBlock={updateBlock} updateBranch={updateBranch} addElseIf={addElseIf} toggleElse={toggleElse} />}
              </div>
            </article>)}

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
