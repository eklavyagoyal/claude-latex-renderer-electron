# Claude Desktop LaTeX Renderer

Render TeX/LaTeX inside Claude conversations from a standalone desktop wrapper.

> Important  
> This project does **not** patch or extend Anthropic's official Claude Desktop app. It launches its **own Electron app**, loads `claude.ai`, and injects a local math-rendering layer on top.

## Why

Claude can produce strong math output, but the desktop experience is not always nicely typeset. This project keeps the fastest practical approach:

- keep Claude's existing web UI and login flow
- wrap it in Electron
- detect math in streamed messages
- render it locally with MathJax

## Approach

- Launch `claude.ai` inside Electron
- Inject a local MathJax SVG pipeline
- Watch the DOM for streamed or newly added content
- Re-typeset only likely math-containing nodes
- Avoid code blocks, editable inputs, and obvious non-math UI
- Keep a manual `Render math` fallback button

The key design choice is simple: this is a **desktop wrapper around Claude Web**, not an in-place modification of the official Claude Desktop app.

## Current Status

- Working proof-of-concept Electron app
- Local MathJax asset rooting to avoid Claude CSP/CDN issues
- Auto-render plus manual fallback rendering
- Keyboard shortcuts for render, devtools, and hard reload
- Packaging and selector hardening still to do

## Quick Start

```bash
npm install
npm start
```

Optional:

```bash
npm run build
```

## Shortcuts

- `Cmd/Ctrl + Shift + M` renders math immediately
- `Cmd/Ctrl + Shift + D` toggles devtools
- `Cmd/Ctrl + Shift + R` hard reloads the app

## Project Files

- [`src/main.ts`](src/main.ts) - Electron shell and injection setup
- [`src/injected.ts`](src/injected.ts) - in-page math detection and rendering logic
- [`implementation.md`](implementation.md) - architecture notes, tradeoffs, and work log

## License

MIT. See [`LICENSE`](LICENSE).

## Support

If this project helps you, please consider starring the repo and supporting the maintainer.
