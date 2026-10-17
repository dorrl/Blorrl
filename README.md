# Blorrl

**A block-first compiled language for algorithms, automation, and server-side ideas.**

Blorrl deliberately skips the usual stage, sprites, and object inspector. Its editor is a compact programming workspace: arrange logic blocks, provide stdin, then **Run** or **Build** from the terminal strip.

## Current prototype

- React + TypeScript + Vite web editor with a dark, terminal-inspired interface.
- Block sequence for print, variables, stdin input, conditions, repeat counts, and addition.
- Fast source-generation pass and a small expression parser/runtime. The runtime is sandboxed by design: it does not use eval, Function, or expose host globals.
- Build shows generated .blorr source; export downloads it as main.blorr.
- Express server provides GET /api/health and serves the production frontend bundle.

The current editor is a prototype, not yet a native machine-code or WebAssembly compiler. The current Run action interprets the supported subset in the browser. Conditional and repeat blocks currently generate source placeholders; nested block editing and their runtime semantics are future work. The intended next compiler milestone is a small typed intermediate representation and a WebAssembly backend, while keeping compilation incremental and lightweight.

## Requirements

- Node.js 20.19+ recommended
- npm

## Development

    npm install
    npm run dev

Vite serves the editor at http://localhost:5173; Express runs at http://localhost:3000. The API health check is http://localhost:3000/api/health.

## Production

    npm run build
    npm start

Set PORT to override the Express port. The production server serves the built frontend from dist/.

## Language sketch

    let base = 40;
    let answer = base + 2;
    print answer;
    let name = input();
    print "hello, " + name;

Expressions currently support numbers, strings, booleans, variable references, parentheses, arithmetic, comparisons, and boolean operators. A variable must be declared before it is read.

## Design principles

1. **Quick builds:** linear source generation with no heavyweight toolchain in the browser.
2. **Predictable execution:** a small parser and interpreter rather than arbitrary JavaScript execution.
3. **Backend-ready:** keep visual blocks separate from generated source and runtime, so a future WASM/native backend can reuse the language front end.
4. **Terminal-first UX:** stdin and stdout/stderr are always visible; no scene or object panels.

## Project layout

- src/App.tsx — editor and block interactions
- src/language.ts — source generation, expression parser, browser runtime
- src/styles.css — responsive Studio interface
- server/index.ts — Express API and production static hosting
