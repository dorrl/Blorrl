# Blorrl

A block-first programming workspace with an Entry-inspired nested block model and a VS Code-style editor.

## Features

- Space + drag pans the workspace; dragging blank space makes a selection rectangle; dragging blocks moves them.
- Shift/Ctrl-click toggles multi-selection. Delete/Backspace removes selected blocks (no delete button on blocks).
- if and repeat blocks own nested blocks; conditionals can add else-if and else branches.
- Variable blocks have a multi-select allowed-type control. Operator blocks are compact and offer +, -, *, / choices.
- The interpreter executes nested conditionals and loops with a 100,000-step guard.
- Source export downloads main.blorr; native build actions request Windows x64 assembly (main.s) or a Windows PE executable (main.exe).
- Express serves the UI and /server/ API on one port (default 3000).

## Native build requirement

Install Zig from https://ziglang.org/download/ on the server and ensure zig is on PATH. Alternatively, set BLORRL_ZIG to the Zig executable path. The backend uses Zig's Clang-compatible compiler to target x86_64-windows-gnu; it does not fake an executable by renaming text. Without Zig, the .s and .exe endpoints return an explicit compiler error.

The current native C lowering is intended for basic expressions and numeric variables; the browser interpreter supports the richer Blorrl expression grammar. String input/printing has basic support, while string concatenation and mixed-type inference are not yet equivalent to the browser runtime.

## Development

    npm install
    npm run dev

Open http://localhost:3000. API health: /server/api/health.

## Production

    npm run build
    npm start

## Language sketch

    let base = 40;
    let answer = base + 2;
    print answer;
    if (answer >= 42) {
      print "ready";
    } else {
      print "not ready";
    }
    repeat (3) {
      print answer;
    }
