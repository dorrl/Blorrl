import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
import { Play, Hammer, Plus, Trash2, Terminal, Blocks, ChevronDown, CircleHelp, Download, RotateCcw, Search, GripVertical, GitBranch, Check } from "lucide-react";
import { compile, runProgram, type Block, type BlockKind } from "./language";

const initialBlocks: Block[] = [
  { id: "b1", kind: "print", value: '"Hello from Blorrl!"' },
  { id: "b2", kind: "let", name: "answer", value: "40 + 2" },
  { id: "b3", kind: "print", value: "answer" },
];
const catalog: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: "print", label: "Print", hint: "Write a value to terminal" },
  { kind: "let", label: "Variable", hint: "Store a value" },
  { kind: "input", label: "Input", hint: "Read a line from stdin" },
  { kind: "if", label: "If condition", hint: "Run a block when true" },
  { kind: "repeat", label: "Repeat", hint: "Repeat a number of times" },
  { kind: "add", label: "Add", hint: "Add two numbers" },
];
type DragPayload = { source: "canvas"; ids: string[] } | { source: "library"; kind: BlockKind };

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
  const canvasRef = useRef<HTMLDivElement>(null);
  const marqueeStart = useRef<{x:number;y:number}|null>(null);
  const compiled = useMemo(() => compile(blocks), [blocks]);
  const visibleCatalog = catalog.filter(item => (item.label + " " + item.hint).toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    let active = true;
    fetch("/server/api/health").then(r => { if (!r.ok) throw new Error("offline"); return r.json(); })
      .then(() => { if (active) setServerOnline(true); })
      .catch(() => { if (active) setServerOnline(false); });
    return () => { active = false; };
  }, []);

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks(current => current.map(block => block.id === id ? { ...block, ...patch } as Block : block));
    setStatus("idle");
  }
  function makeBlock(kind: BlockKind): Block {
    return { id: crypto.randomUUID(), kind, value: kind === "print" ? '"Hello!"' : kind === "input" ? "value" : kind === "if" ? "true" : "1", name: "value" } as Block;
  }
  function addBlock(kind: BlockKind, beforeId?: string) {
    const block = makeBlock(kind);
    setBlocks(current => {
      if (!beforeId) return [...current, block];
      const index = current.findIndex(item => item.id === beforeId);
      return index < 0 ? [...current, block] : [...current.slice(0, index), block, ...current.slice(index)];
    });
    setSelected([block.id]); setStatus("idle");
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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-blorrl", JSON.stringify(payload));
  }
  function onDrop(event: DragEvent, targetId?: string) {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData("application/x-blorrl");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.source === "library") addBlock(payload.kind, targetId);
      else moveSelection(payload.ids, targetId);
    } catch { /* Ignore invalid drag payloads. */ }
  }
  function startMarquee(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".block-card,button,input,textarea,.start-node")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    marqueeStart.current = point;
    setMarquee({ ...point, w: 0, h: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveMarquee(event: PointerEvent<HTMLDivElement>) {
    if (!marqueeStart.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const start = marqueeStart.current;
    const box = { x: Math.min(start.x,x), y: Math.min(start.y,y), w: Math.abs(x-start.x), h: Math.abs(y-start.y) };
    setMarquee(box);
    const next = Array.from(canvasRef.current.querySelectorAll<HTMLElement>("[data-block-id]")).filter(el => {
      const r = el.getBoundingClientRect();
      const left = r.left - rect.left, top = r.top - rect.top;
      return left < box.x + box.w && left + r.width > box.x && top < box.y + box.h && top + r.height > box.y;
    }).map(el => el.dataset.blockId!).filter(Boolean);
    setSelected(next);
  }
  function endMarquee() { marqueeStart.current = null; setMarquee(null); }
  function selectBlock(event: MouseEvent, id: string) {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    } else if (!selected.includes(id)) setSelected([id]);
  }
  function run() {
    setBusy(true);
    try {
      const result = runProgram(compiled, stdin);
      setOutput(result.error || result.output || "(no output)");
      setStatus(result.error ? "error" : "ran");
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); setStatus("error"); }
    finally { setBusy(false); }
  }
  function build() {
    setOutput(compiled.errors.length ? compiled.errors.join("\n") : compiled.code);
    setStatus(compiled.errors.length ? "error" : "built");
  }
  function exportSource() {
    const blob = new Blob([compiled.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "main.blorr"; a.click(); URL.revokeObjectURL(url);
  }

  return <main className="studio">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Blocks size={18}/></span><span>blorrl<span className="brand-dot">.</span></span><span className="studio-tag">STUDIO</span></a>
      <div className="top-meta"><span className="live-dot"/><span>WORKSPACE</span><span className="version">develop / main.blorr</span></div>
      <div className="top-actions"><span className={"server-indicator " + (serverOnline === true ? "online" : serverOnline === false ? "offline" : "")}><span/>{serverOnline === true ? "SERVER CONNECTED" : serverOnline === false ? "SERVER OFFLINE" : "CONNECTING"}</span><button className="icon-button" title="Language guide" onClick={() => setShowHelp(v => !v)}><CircleHelp size={16}/></button><button className="subtle-button" onClick={() => {setBlocks(initialBlocks);setSelected(["b1"]);setStatus("idle");}}><RotateCcw size={13}/> Reset</button><button className="build-button" onClick={build}><Hammer size={14}/> Build</button><button className="run-button" disabled={busy} onClick={run}><Play size={14} fill="currentColor"/> Run</button></div>
    </header>
    <section className="workspace">
      <aside className="sidebar">
        <div className="side-title"><span>EXPLORER</span><span className="side-menu">···</span></div>
        <div className="project-row"><ChevronDown size={13}/><span className="folder-glyph">▣</span><strong>BLORRL PROJECT</strong></div>
        <div className="file-row"><span className="file-glyph">B</span><span>main.blorr</span><span className="file-unsaved"/></div>
        <div className="library-head"><span>BLOCKS</span><span>{visibleCatalog.length.toString().padStart(2,"0")}</span></div>
        <div className="library-search"><Search size={13}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter blocks"/></div>
        <div className="catalog-list">
          {visibleCatalog.map(item => <button key={item.kind} className="catalog-item" draggable onDragStart={e => onDragStart(e,{source:"library",kind:item.kind})} onClick={() => addBlock(item.kind)} title="Click to add or drag into the workspace"><span className={"catalog-icon " + item.kind}><Plus size={14}/></span><span className="catalog-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><GripVertical size={14} className="catalog-grip"/></button>)}
        </div>
        <div className="sidebar-bottom"><div className="sidebar-section-label">OUTLINE</div><div className="outline-row"><GitBranch size={13}/><span>main</span><span className="outline-count">{blocks.length}</span></div><div className="sidebar-note">Drag blocks to connect the flow. Select multiple blocks with Shift/Ctrl or by dragging over empty canvas.</div></div>
      </aside>
      <section className="editor">
        <div className="tabbar"><div className="editor-tab"><span className="tab-file-icon">B</span>main.blorr<span className="tab-unsaved"/></div><div className="tabbar-spacer"/><span className="tab-language">BLORRL</span><button className="icon-button tab-export" title="Export source" onClick={exportSource}><Download size={15}/></button></div>
        <div className="breadcrumb"><span>main.blorr</span><span>›</span><span>main</span><span className="breadcrumb-right">{blocks.length} blocks</span></div>
        <div className="pane-heading"><div><span className="pane-eyebrow">VISUAL EDITOR</span><h1>Program flow</h1></div><div className="pane-tools"><span className="saved-indicator"><span/> All changes local</span><button className="icon-button" title="Export source" onClick={exportSource}><Download size={15}/></button></div></div>
        {showHelp && <div className="help-panel"><strong>Quick language guide</strong><p>Drag a block onto another to insert it before that block. Drag from the library into the flow to add it. Click to select, Shift/Ctrl-click to add or remove blocks, or drag over empty canvas to marquee-select. Dragging a selected block moves the selection as a group. Use Build to inspect generated source or Run to execute it.</p><code>print "hello";</code></div>}
        <div className="block-canvas" ref={canvasRef} onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={endMarquee} onPointerCancel={endMarquee} onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e)}>
          <div className="canvas-ruler"><span>PROGRAM ENTRY</span><span>DRAG TO REORDER / CONNECT</span></div>
          <div className="start-node"><span className="start-play"><Play size={13} fill="currentColor"/></span><div><strong>Start</strong><small>Program entry point · fixed</small></div><span className="fixed-pill"><Check size={10}/> FIXED</span></div>
          <div className="flow-stem"><span/></div>
          {blocks.length === 0 && <div className="empty-state"><Blocks size={26}/><strong>Drop a block to begin</strong><span>Drag from the Explorer or click a block on the left.</span></div>}
          {blocks.map((block,index) => <div key={block.id} className="flow-item">
            <div className="connector"><span/></div>
            <article data-block-id={block.id} draggable className={"block-card kind-" + block.kind + (selected.includes(block.id) ? " selected" : "")} onClick={e => selectBlock(e,block.id)} onDragStart={e => onDragStart(e,{source:"canvas",ids:selected.includes(block.id) ? selected : [block.id]})} onDragOver={e => {e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("drop-target");}} onDragLeave={e => e.currentTarget.classList.remove("drop-target")} onDrop={e => {e.currentTarget.classList.remove("drop-target");onDrop(e,block.id);}}>
              <div className="block-gutter"><GripVertical size={14}/><span>{String(index+1).padStart(2,"0")}</span></div>
              <div className="block-content"><div className="block-type"><span className={"type-icon " + block.kind}><Blocks size={13}/></span><strong>{catalog.find(c=>c.kind===block.kind)?.label ?? block.kind}</strong><span className="block-kind">{block.kind.toUpperCase()}</span></div>
                <div className="block-fields">
                  {block.kind === "let" && <><label>NAME<input value={block.name ?? ""} onChange={e=>updateBlock(block.id,{name:e.target.value})} onClick={e=>e.stopPropagation()} /></label><label>VALUE<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label></>}
                  {block.kind === "input" && <><label>STORE AS<input value={block.name ?? ""} onChange={e=>updateBlock(block.id,{name:e.target.value})} onClick={e=>e.stopPropagation()} /></label><span className="field-hint">Reads one line from terminal input</span></>}
                  {block.kind === "print" && <label className="wide-field">EXPRESSION<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label>}
                  {block.kind === "if" && <label className="wide-field">CONDITION<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label>}
                  {block.kind === "repeat" && <label>COUNT<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label>}
                  {block.kind === "add" && <><label>LEFT<input value={block.value} onChange={e=>updateBlock(block.id,{value:e.target.value})} onClick={e=>e.stopPropagation()} /></label><label>RIGHT<input value={block.right ?? "1"} onChange={e=>updateBlock(block.id,{right:e.target.value})} onClick={e=>e.stopPropagation()} /></label></>}
                </div>
              </div>
              <button className="delete-block" title="Remove block" onClick={e=>{e.stopPropagation();setBlocks(current=>current.filter(b=>b.id!==block.id));setSelected(current=>current.filter(id=>id!==block.id));setStatus("idle");}}><Trash2 size={14}/></button>
            </article>
          </div>)}
          <div className="connector last-connector"><span/></div><button className="add-inline" onClick={()=>addBlock("print")}><Plus size={14}/> Add block to flow</button>
          {marquee && <div className="selection-marquee" style={{left:marquee.x,top:marquee.y,width:marquee.w,height:marquee.h}}/>}
        </div>
        <div className="editor-footer"><span><span className="footer-dot"/> {selected.length} selected <span className="footer-separator">·</span> {blocks.length} blocks in flow</span><span>SHIFT / CTRL TO MULTI-SELECT</span></div>
      </section>
    </section>
    <section className="terminal">
      <div className="terminal-top"><div className="terminal-title"><Terminal size={15}/><strong>TERMINAL</strong><span className="terminal-divider">/</span><span>OUTPUT</span></div><div className="terminal-status"><span className={"status-dot " + status}/>{status==="ran"?"EXECUTED":status==="built"?"BUILD SUCCESS":status==="error"?"ERROR":"IDLE"}<button className="clear-button" onClick={()=>{setOutput("");setStatus("idle");}}>Clear</button></div></div>
      <div className="terminal-body"><div className="terminal-input"><label htmlFor="stdin">STDIN</label><textarea id="stdin" value={stdin} onChange={e=>setStdin(e.target.value)} placeholder="Type input here… (one line per read)" rows={2}/><span>INPUT BUFFER</span></div><div className="terminal-output"><div className="output-label"><span>STDOUT / STDERR</span><span>UTF-8</span></div><pre className={status==="error"?"error-text":""}>{output}</pre></div></div>
      <div className="terminal-bottom"><span>BLORRL RUNTIME <b>·</b> BROWSER SANDBOX</span><span>COMPILE <b>·</b> {compiled.errors.length?"ERRORS":"INSTANT"}</span></div>
    </section>
    <footer className="statusbar"><span><span className="status-light"/> {serverOnline === false ? "Server connection unavailable" : "Ready"} <span className="statusbar-path">/ main.blorr</span></span><span>UTF-8 <b>·</b> TYPESCRIPT <b>·</b> <ChevronDown size={12}/></span></footer>
  </main>;
}
