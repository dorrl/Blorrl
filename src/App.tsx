import { useMemo, useState } from "react";
import { Play, Hammer, Plus, Trash2, Terminal, Blocks, ChevronDown, CircleHelp, Download, RotateCcw } from "lucide-react";
import { compile, runProgram, type Block, type BlockKind } from "./language";

const initialBlocks: Block[] = [
  { id: "b1", kind: "print", value: "Hello from Blorrl!" },
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

export default function App() {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState("Ready. Run your program to see output here.");
  const [status, setStatus] = useState<"idle" | "built" | "ran" | "error">("idle");
  const [active, setActive] = useState("b1");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const compiled = useMemo(() => compile(blocks), [blocks]);

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks(current => current.map(block => block.id === id ? { ...block, ...patch } as Block : block));
    setStatus("idle");
  }
  function addBlock(kind: BlockKind) {
    const block = { id: crypto.randomUUID(), kind, value: kind === "print" ? '"Hello!"' : kind === "input" ? "value" : "1", name: "value" } as Block;
    setBlocks(current => [...current, block]); setActive(block.id); setStatus("idle");
  }
  function run() {
    setBusy(true);
    try {
      const result = runProgram(compiled, stdin);
      setOutput(result.output || "(no output)");
      setStatus(result.error ? "error" : "ran");
      if (result.error) setOutput(result.error);
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); setStatus("error"); }
    finally { setBusy(false); }
  }
  function build() {
    setOutput(compiled.errors.length ? compiled.errors.join("\n") : compiled.code);
    setStatus(compiled.errors.length ? "error" : "built");
  }

  return <main className="studio">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Blocks size={19}/></span><span>blorrl<span className="brand-dot">.</span></span><span className="studio-tag">STUDIO</span></a>
      <div className="top-meta"><span className="live-dot"/> <span>LOCAL WORKSPACE</span><span className="version">v0.1 alpha</span></div>
      <div className="top-actions"><button className="icon-button" title="Language guide" onClick={() => setShowHelp(v => !v)}><CircleHelp size={17}/></button><button className="subtle-button" onClick={() => { setBlocks(initialBlocks); setStatus("idle"); }}><RotateCcw size={14}/> Reset</button><button className="build-button" onClick={build}><Hammer size={15}/> Build</button><button className="run-button" disabled={busy} onClick={run}><Play size={15} fill="currentColor"/> Run</button></div>
    </header>
    <section className="workspace">
      <aside className="sidebar">
        <div className="section-kicker">BLOCK LIBRARY <span>06</span></div>
        <p className="sidebar-intro">Build logic, not a scene. Add a block to your program.</p>
        {catalog.map(item => <button className="catalog-item" key={item.kind} onClick={() => addBlock(item.kind)}><span className={"catalog-icon " + item.kind}><Plus size={15}/></span><span className="catalog-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><Plus className="catalog-plus" size={14}/></button>)}
        <div className="sidebar-note"><span className="note-mark">i</span><span>Blorrl is designed for algorithms, automation, and server-side tasks.</span></div>
      </aside>
      <section className="editor">
        <div className="pane-heading"><div><span className="pane-eyebrow">WORKSPACE / MAIN</span><h1>Program blocks <span className="count">{blocks.length}</span></h1></div><div className="pane-tools"><span className="saved-indicator"><span/> In memory</span><button className="icon-button" title="Export source" onClick={() => { const blob = new Blob([compiled.code], {type:"text/plain"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="main.blorr"; a.click(); URL.revokeObjectURL(url); }}><Download size={16}/></button></div></div>
        {showHelp && <div className="help-panel"><strong>Quick language guide</strong><p>Print values, declare variables, and read input. Expressions support arithmetic and comparisons. Use Build to inspect generated Blorrl source, or Run to execute it in the browser.</p><code>print "hello";</code></div>}
        <div className="block-canvas">
          <div className="flow-line"/>
          {blocks.length === 0 && <div className="empty-state"><Blocks size={25}/><strong>Your program is empty</strong><span>Add a block from the library to get started.</span></div>}
          {blocks.map((block, index) => <article key={block.id} className={"block-card kind-" + block.kind + (active === block.id ? " selected" : "")} onClick={() => setActive(block.id)}>
            <div className="block-rail"><span>{String(index + 1).padStart(2, "0")}</span><div className="rail-dot"/></div>
            <div className="block-content"><div className="block-type"><span className={"type-icon " + block.kind}><Blocks size={13}/></span><strong>{catalog.find(c => c.kind === block.kind)?.label ?? block.kind}</strong><span className="block-kind">{block.kind.toUpperCase()}</span></div>
              <div className="block-fields">
                {block.kind === "let" && <><label>NAME<input value={block.name ?? ""} onChange={e => updateBlock(block.id, {name:e.target.value})} onClick={e => e.stopPropagation()} /></label><label>VALUE<input value={block.value} onChange={e => updateBlock(block.id, {value:e.target.value})} onClick={e => e.stopPropagation()} /></label></>}
                {block.kind === "input" && <><label>STORE AS<input value={block.name ?? ""} onChange={e => updateBlock(block.id, {name:e.target.value})} onClick={e => e.stopPropagation()} /></label><span className="field-hint">Reads one line from terminal input</span></>}
                {block.kind === "print" && <label className="wide-field">EXPRESSION<input value={block.value} onChange={e => updateBlock(block.id, {value:e.target.value})} onClick={e => e.stopPropagation()} /></label>}
                {block.kind === "if" && <label className="wide-field">CONDITION<input value={block.value} onChange={e => updateBlock(block.id, {value:e.target.value})} onClick={e => e.stopPropagation()} /></label>}
                {block.kind === "repeat" && <label>COUNT<input value={block.value} onChange={e => updateBlock(block.id, {value:e.target.value})} onClick={e => e.stopPropagation()} /></label>}
                {block.kind === "add" && <><label>LEFT<input value={block.value} onChange={e => updateBlock(block.id, {value:e.target.value})} onClick={e => e.stopPropagation()} /></label><label>RIGHT<input value={block.right ?? "1"} onChange={e => updateBlock(block.id, {right:e.target.value})} onClick={e => e.stopPropagation()} /></label></>}
              </div>
            </div>
            <button className="delete-block" title="Remove block" onClick={e => {e.stopPropagation(); setBlocks(current => current.filter(b => b.id !== block.id)); setStatus("idle");}}><Trash2 size={15}/></button>
          </article>)}
          <button className="add-inline" onClick={() => addBlock("print")}><Plus size={15}/> Add print block</button>
        </div>
        <div className="editor-footer"><span><span className="footer-dot"/> {blocks.length} blocks in sequence</span><span>DRAG-AND-DROP NESTING COMING LATER</span></div>
      </section>
    </section>
    <section className="terminal">
      <div className="terminal-top"><div className="terminal-title"><Terminal size={16}/><strong>TERMINAL</strong><span className="terminal-divider">/</span><span>RUN & BUILD OUTPUT</span></div><div className="terminal-status"><span className={"status-dot " + status}/>{status === "ran" ? "EXECUTED" : status === "built" ? "BUILD SUCCESS" : status === "error" ? "ERROR" : "IDLE"}<button className="clear-button" onClick={() => {setOutput("");setStatus("idle");}}>Clear</button></div></div>
      <div className="terminal-body"><div className="terminal-input"><label htmlFor="stdin">STDIN</label><textarea id="stdin" value={stdin} onChange={e => setStdin(e.target.value)} placeholder="Type input here… (one line per read)" rows={2}/><span>INPUT BUFFER</span></div><div className="terminal-output"><div className="output-label"><span>STDOUT / STDERR</span><span>UTF-8</span></div><pre className={status === "error" ? "error-text" : ""}>{output}</pre></div></div>
      <div className="terminal-bottom"><span>BLORRL RUNTIME <b>·</b> BROWSER SANDBOX</span><span>COMPILE TIME <b>·</b> {compiled.errors.length ? "ERRORS" : "INSTANT"}</span></div>
    </section>
    <footer className="statusbar"><span><span className="status-light"/> All systems nominal</span><span>UTF-8 <b>·</b> TYPESCRIPT TOOLCHAIN <b>·</b> <ChevronDown size={12}/></span></footer>
  </main>;
}