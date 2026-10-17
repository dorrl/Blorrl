# Blorrl

**A block-first language workspace for algorithms, automation, and server-side ideas.**

Blorrl uses a VS Code-inspired editor layout rather than a scene or object inspector. Blocks connect into a vertical program flow; the fixed Start node cannot be moved or deleted. Drag a block onto another to insert it before the target, or drag a library block into the flow. Select individual blocks with click, toggle selection with Shift/Ctrl-click, or drag a rectangle across empty canvas to select several blocks. Dragging a selected block moves the selection as a group.

## Current prototype

- React + TypeScript + Vite editor with Explorer, tabs, breadcrumbs, status bar, and terminal.
- Print, variables, stdin input, conditions, repeat counts, and addition blocks.
- Source generation and a sandboxed expression parser/runtime; no eval, Function, or host globals.
- Build displays generated .blorr source; Export downloads main.blorr.
- Express serves the frontend and API from a **single port**. All backend routes are namespaced under /server/; health check: /server/api/health.
- Development mode embeds Vite as Express middleware, so there is no separate Vite port or proxy port to remember.

This remains a prototype, not a native machine-code or WebAssembly compiler. The browser interpreter currently skips conditional and repeat bodies; nested execution semantics and a WebAssembly backend remain future work.

## Requirements

- Node.js 20.19+ recommended
- npm

## Development

    npm install
    npm run dev

Open http://localhost:3000. The same origin serves the editor and /server/api/health; set PORT to change the single port.

## Production

    npm run build
    npm start

Production serves the built frontend and the /server/ API on the same port.

## Language sketch

    let base = 40;
    let answer = base + 2;
    print answer;
    let name = input();
    print "hello, " + name;

Expressions currently support numbers, strings, booleans, variable references, parentheses, arithmetic, comparisons, and boolean operators. A variable must be declared before it is read.
