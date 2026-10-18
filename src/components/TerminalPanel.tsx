import { GitBranch, Terminal } from "lucide-react";

type RunStatus = "idle" | "built" | "ran" | "error";

type TerminalPanelProps = {
  stdin: string;
  onStdinChange: (value: string) => void;
  output: string;
  status: RunStatus;
  onClear: () => void;
  hasCompileErrors: boolean;
  blockCount: number;
};

export function TerminalPanel({ stdin, onStdinChange, output, status, onClear, hasCompileErrors, blockCount }: TerminalPanelProps) {
  return <section className="terminal">
    <div className="terminal-top">
      <div className="terminal-title"><Terminal size={15}/><strong>TERMINAL</strong><span className="terminal-divider">/</span><span>OUTPUT</span></div>
      <div className="terminal-outline"><span className="terminal-outline-label">OUTLINE</span><GitBranch size={13}/><span>main</span><span className="terminal-outline-count">{blockCount}</span></div>
      <div className="terminal-status"><span className={"status-dot " + status}/>{status==="ran"?"EXECUTED":status==="built"?"BUILD SUCCESS":status==="error"?"ERROR":"IDLE"}<button className="clear-button" onClick={onClear}>Clear</button></div>
    </div>
    <div className="terminal-body"><div className="terminal-input"><label htmlFor="stdin">STDIN</label><textarea id="stdin" value={stdin} onChange={event => onStdinChange(event.target.value)} placeholder="Type input here… (one line per read)" rows={2}/><span>INPUT BUFFER</span></div><div className="terminal-output"><div className="output-label"><span>STDOUT / STDERR</span><span>UTF-8</span></div><pre className={status==="error"?"error-text":""}>{output}</pre></div></div>
    <div className="terminal-bottom"><span>BLORRL RUNTIME <b>·</b> NATIVE BUILD VIA ZIG</span><span>COMPILE <b>·</b> {hasCompileErrors ? "ERRORS" : "ASSEMBLY"}</span></div>
  </section>;
}
