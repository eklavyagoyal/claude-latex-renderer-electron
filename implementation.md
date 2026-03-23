# Claude Desktop LaTeX Renderer

## Date

2026-03-23

## Goal

Build a desktop-first version of the behavior demonstrated by `kivvi3412/Claude_Latex_Renderer`: take Claude output that contains TeX/LaTeX and render it cleanly inside a desktop experience with as little user friction as possible.

This document captures:

- what I inspected
- what the reference repo actually does
- how viable the desktop versions are
- which path is fastest and least painful
- the implementation direction I recommend
- the exact work log from this session

## Current Workspace State

- Local workspace path: `/Users/eklavya.goyal/Projects/claude-desktop-latex-renderer`
- The workspace was empty when I started.
- It started as a non-Git workspace and is now initialized as a Git repository with `main` as the default branch.
- There was no existing implementation to preserve or extend.
- The workspace now contains an initial Electron + TypeScript scaffold plus a bundled MathJax injection path.

## Current Output After This Pass

Files now created:

- `.gitignore`
- `LICENSE`
- `README.md`
- `package-lock.json`
- `package.json`
- `tsconfig.json`
- `scripts/build.mjs`
- `src/main.ts`
- `src/injected.ts`
- `implementation.md`

Build artifacts currently generated:

- `dist/main.js`
- `dist/injected.js`
- `dist/vendor/mathjax.js`
- `dist/vendor/output/fonts/mathjax-newcm/svg.js`
- `dist/vendor/output/fonts/mathjax-newcm/svg/dynamic/*`

Current run commands:

- `npm run build`
- `npm start`

Current keyboard shortcuts:

- `Cmd+Shift+M` or `Ctrl+Shift+M`: render math now
- `Cmd+Shift+D` or `Ctrl+Shift+D`: toggle devtools
- `Cmd+Shift+R` or `Ctrl+Shift+R`: hard reload

What the scaffold does right now:

- launches an Electron desktop shell
- loads `https://claude.ai`
- injects a local MathJax bundle at page load
- injects an observer-driven rendering script
- adds a floating `Render math` fallback button
- watches for streamed/new content and retries typesetting automatically
- uses a local SVG-based MathJax pipeline rooted in app-owned assets
- supports `Shift`-click on the render button to toggle auto-render
- forwards renderer warnings/errors and app-specific logs into the terminal
- declares the MathJax NewCM font package as a direct dependency because the build copies assets from it explicitly
- includes a concise GitHub-ready README and MIT license

## Current Gaps

- I validated the scaffold builds locally, and the Electron shell now launches successfully, but I have not completed a full visual authenticated smoke test against a real Claude math-heavy conversation from this environment.
- The DOM targeting is intentionally generic for the first pass and will likely need tuning once we inspect Claude's live message structure inside the desktop shell.
- There is no packaging, notarization, updater, or settings UI yet.
- There are no automated tests yet; current validation is build-level and typecheck-level only.

## Runtime Findings From This Pass

### 1. Electron startup initially failed because the main bundle inlined Electron itself

Observed behavior:

- `npm start` crashed with: `Electron failed to install correctly`

Root cause:

- the main-process esbuild output bundled `electron` instead of leaving it as a runtime dependency

Fix applied:

- marked `electron` as external in the main-process build

Result:

- the app now launches successfully

### 2. MathJax initially failed because it tried to fetch font/runtime assets from jsDelivr

Observed behavior:

- Claude's CSP blocked requests for MathJax font/runtime assets hosted on jsDelivr

Root cause:

- evaluating MathJax component code via `executeJavaScript()` meant there was no `currentScript` URL for MathJax to infer a local asset root from
- with no explicit local loader root, MathJax fell back to its default CDN-based font path

Fix applied:

- switched the copied runtime bundle to the local combined MathJax + NewCM SVG entrypoint
- copied the required local SVG font runtime into `dist/vendor/output/fonts/mathjax-newcm/`
- set `window.MathJax.loader.paths.mathjax` to the local `file://.../dist/vendor` root before loading MathJax

Result:

- the previous MathJax CSP violation no longer appeared in the follow-up runtime polling window

### 3. Debugging became much more useful after forwarding renderer warnings/errors

What changed:

- the Electron main process now forwards renderer console warnings/errors and our own renderer logs to the terminal
- noisy informational logs are filtered out

Why this matters:

- we can now see Claude-side CSP, navigation, and renderer issues without guessing

## What The Reference Repo Actually Does

Reference repo:

- `https://github.com/kivvi3412/Claude_Latex_Renderer/tree/main`

Files inspected from a local temp clone:

- `README.md`
- `main.js`
- `easiest.js`

What it does in practice:

- It is a very small Tampermonkey userscript approach, not a full app.
- It injects MathJax 2.7.7 from a CDN into the page.
- It targets `https://claude.ai/*` in `main.js`.
- It creates a floating `Render Latex` button in `main.js`.
- Clicking the button manually triggers MathJax typesetting.
- It also triggers a render on `window.load`.
- `easiest.js` is a more general version that observes DOM mutations and re-runs typesetting automatically.

What matters architecturally:

- The repo does not own the chat UI.
- The repo does not parse Claude responses before they render.
- The repo works by post-processing an already-rendered web page DOM.

That is the key insight for desktop: if we want "the same thing, but desktop", the fastest path is not "build a whole AI client from scratch". The fastest path is "own a desktop shell and inject a math-rendering layer into the rendered Claude page or page-equivalent".

## Feasibility Summary

Short version:

- Yes, this is possible.
- It is very viable if we build our own desktop shell.
- It is much less viable if the target is modifying Anthropic's official Claude Desktop app in-place.

My practical verdict:

- Custom desktop shell around `claude.ai`: highly viable
- Full independent desktop client using the Anthropic API: viable, but slower
- Reverse-engineering or patching the official Claude Desktop app: technically possible, product-wise weak
- Overlay-only / screen-scraping solution: not recommended

## Desktop Paths Compared

### Option 1: Build our own Electron desktop shell around `claude.ai`

How it works:

- Open Claude inside an Electron window or view.
- Inject a local math renderer plus a DOM observer.
- Re-typeset only message content regions.
- Add a tiny desktop settings/toggle layer for automatic rendering, retry, and debug logging.

Pros:

- Fastest route to a usable MVP
- We keep Claude's existing auth, conversation sync, and product UI
- We only have to solve rendering, not everything else
- Good fit for the reference repo's architecture

Cons:

- We depend on Claude's DOM structure
- A Claude frontend update can break selectors or heuristics
- Packaging/distribution is ours to maintain

Verdict:

- This is the best "fast and painless" path.

### Option 2: Build a full independent desktop client with the Anthropic API

How it works:

- Build our own desktop chat UI.
- Call the Anthropic API directly.
- Render markdown and LaTeX ourselves.

Pros:

- Maximum control
- Best long-term maintainability of rendering
- No DOM scraping
- Easier to add custom features later

Cons:

- Much more product surface area
- Requires separate auth/API story
- Harder to reach parity with the consumer Claude app
- More work before the first satisfying demo

Verdict:

- Good long-term path if the project grows beyond "render math inside Claude".
- Not the fastest path to value.

### Option 3: Patch or hook into the official Claude Desktop app

How it works:

- Reverse engineer the shipped app.
- Find renderer surfaces, preload hooks, or bundle patch points.
- Inject math rendering there.

Pros:

- Uses the official app UI directly

Cons:

- High breakage risk
- Code signing and update issues
- Distribution is awkward
- Not a supported extension surface for UI rendering
- Security and compliance concerns are much harder

Verdict:

- Hobby-hack possible, product strategy bad.

### Option 4: Build an external overlay or OCR/screen parser

How it works:

- Read visible UI content from the screen or accessibility tree.
- Render a separate overlay on top of the Claude app.

Pros:

- Does not require owning the page

Cons:

- Extremely brittle
- Accessibility and layout pain
- Hard to align with scrolling/selection
- Bad UX compared to native in-page rendering

Verdict:

- Not worth pursuing.

## Recommended Path

Recommendation:

- Start with an Electron desktop shell that loads `https://claude.ai` and injects a local rendering pipeline.

Why this is the best first move:

- It matches the reference repo's core trick.
- It keeps scope small.
- It avoids reverse-engineering the official Claude Desktop app.
- It gives us full control over injection timing, settings, logging, and recovery.
- It can become a polished standalone app quickly.

## External Research Notes

I also reviewed platform documentation to sanity-check the feasibility call.

What that research suggests:

- Claude desktop extensions are positioned as installable local MCP server packages, which is useful for tools and data access, but not obviously a message-renderer customization API.
- Claude's newer desktop extension/connectors material appears focused on connecting Claude to local apps, files, and external services.
- Electron's documented `webContents` lifecycle and script execution APIs are a strong fit for a wrapper app that loads a remote web app and injects behavior at the right time.

Practical implication:

- There is a clear documented path for "Electron wrapper that injects rendering behavior".
- There is not a clear documented path for "supported Claude Desktop extension that patches Claude's own chat renderer".

## What "Fast And Painless" Actually Means Here

To keep this fast and painless, we should optimize for:

- minimal moving parts
- local bundled assets instead of remote CDN dependencies
- automatic rendering with a manual fallback button
- narrow DOM targeting instead of typesetting the entire page repeatedly
- debounced mutation handling
- strong defaults with one obvious install/run path

That translates into the following implementation choices.

## Technical Recommendation

### App shell

Use:

- Electron
- TypeScript
- One main browser surface
- A preload/injection setup with `contextIsolation` enabled

Why Electron:

- It is the easiest desktop stack for "load a remote web app and control/instrument it".
- It gives us load events, script injection, CSS injection, navigation controls, devtools, packaging, and cross-platform desktop behavior in one place.

Tauri is lighter, but for this exact job Electron is the more frictionless choice.

### Rendering engine

Initial recommendation:

- Use MathJax, but bundle it locally inside the app instead of loading it from a CDN.

Reason:

- The reference repo already proves the core behavior with MathJax.
- Compatibility is more important than absolute speed for the first version.

Potential later optimization:

- Add a KaTeX fast path for common expressions if performance becomes a real issue.

### Injection model

We should not:

- re-typeset the whole document body on every mutation

We should:

- detect Claude message containers
- ignore `pre`, `code`, editable inputs, and tool UI
- debounce changes during streaming
- typeset only the nodes that changed
- tag processed nodes to avoid duplicate work

### UX model

The first version should include:

- auto-render enabled by default
- a small manual "Render math" button as a fallback
- a toggle for auto-render
- a debug mode that outlines detected math containers
- a retry action if Claude's DOM changes or a page segment loads late

This keeps the product resilient without making the UI heavy.

## Architecture Sketch

### MVP architecture

1. Electron app launches.
2. Main window loads `https://claude.ai`.
3. On page load, we inject:
   - bundled math renderer
   - DOM observer
   - node classifier for assistant/user message regions
   - safe typesetting routine
   - optional floating control button
4. Mutation observer watches for streamed or newly-added content.
5. Rendering queue debounces updates and typesets only new math-bearing nodes.
6. Settings are stored locally.

### What is already implemented

- Electron app bootstrap with a persistent browser partition for Claude login state
- local build pipeline that bundles main/injected code and copies MathJax locally
- page-load injection flow from the Electron main process
- MathJax configuration with common inline and display delimiters
- DOM mutation observer for newly streamed or appended content
- manual fallback button for forced re-rendering
- TypeScript validation and successful local build

### Core modules we likely want

- `src/main/`
  - Electron app bootstrap
  - window creation
  - safe navigation policy

- `src/preload/`
  - renderer bootstrap bridge
  - settings bridge

- `src/injected/`
  - math engine loader
  - DOM observer
  - selector strategy
  - typeset queue
  - retry/fallback controls

- `src/shared/`
  - config
  - event names
  - renderer mode types

## Key Risks

### 1. DOM churn on Claude's side

Risk:

- Claude changes class names, markup structure, or message layout.

Mitigation:

- Avoid brittle selectors when possible.
- Target semantic structure and text-bearing regions.
- Centralize selector logic in one adapter module.
- Keep a manual render button as a failsafe.

### 2. Performance during streaming responses

Risk:

- MutationObserver fires excessively while Claude streams tokens.

Mitigation:

- Debounce aggressively.
- Typeset only stable leaf containers.
- Track already-processed nodes.
- Avoid full-document walks.

### 3. Rendering inside code fences or inline code

Risk:

- We accidentally convert example TeX or code snippets that should stay literal.

Mitigation:

- Explicitly ignore `pre`, `code`, `textarea`, `input`, and editable regions.
- Add tests/fixtures for mixed markdown + math outputs.

### 4. CSP or remote script loading issues

Risk:

- CDN-hosted scripts fail, are blocked, or add latency.

Mitigation:

- Bundle the renderer locally in the app.

### 5. Auth and account session quirks in an embedded browser

Risk:

- Login flows, passkeys, or anti-bot checks behave differently.

Mitigation:

- Keep the shell as close to a normal browser window as possible.
- Avoid exotic user-agent manipulation unless necessary.
- Test login early before building much more.

### 6. Distribution and updates

Risk:

- macOS signing/notarization or Windows packaging becomes a later bottleneck.

Mitigation:

- Start local-only for development.
- Choose a packaging tool early.
- Keep the app structure conventional.

## Official Claude Desktop Extension Route: Why I Do Not Recommend It

If the question is "can we make the official Claude Desktop app itself render LaTeX via a proper supported extension?", my current answer is:

- probably not through the documented extension path

Why:

- Claude desktop extensions are documented as local MCP server bundles.
- That extension surface is about tools, resources, actions, and local integrations.
- I do not see evidence in the documented extension model that it is meant to let us replace or patch Claude's internal message renderer.

So:

- If we insist on official-app integration, we are likely stepping into unsupported reverse-engineering territory.
- That is slower, more brittle, and worse for maintenance.

## Recommended Phases

### Phase 0: Prove the rendering loop

Deliverable:

- Minimal Electron shell that loads Claude and can inject math rendering.

Success criteria:

- User can log in
- Example LaTeX renders
- Manual fallback button works

### Phase 1: Make it automatic and stable

Deliverable:

- Mutation observer with debounced, scoped typesetting.

Success criteria:

- New streamed Claude responses render automatically
- Code fences are not corrupted
- Performance stays acceptable in long chats

### Phase 2: Harden the UX

Deliverable:

- Settings, debug tools, recovery button, platform packaging.

Success criteria:

- App is easy to install and easy to recover if selectors drift

### Phase 3: Decide if this becomes a product

Decision point:

- Stay as a focused wrapper for math rendering
- Or evolve into a fuller custom Claude desktop client

## Estimated Effort

Assuming we choose the Electron wrapper approach:

- Proof of concept: 1 to 3 focused days
- Stable internal tool: about 1 week
- Polished packaged desktop app: 1 to 2 additional weeks

Assuming we choose official-app patching instead:

- Unknown and likely slower than it looks
- Breakage risk remains high even after it works once

## What I Would Build Next

If we continue immediately, my next implementation step would be:

1. Scaffold an Electron + TypeScript app.
2. Load `claude.ai` in the main web surface.
3. Inject a locally bundled math renderer after page load.
4. Add a very small safe MutationObserver pipeline.
5. Test with a fixed set of LaTeX examples.

That gives us the shortest path to something real.

## Work Log

### Actions completed in this session

1. Checked the working directory:
   - `pwd`

2. Checked whether the current workspace already had files:
   - `rg --files`
   - `ls -la`
   - `find . -maxdepth 2 -mindepth 1 | sort`

3. Checked repository status:
   - `git status --short`

4. Confirmed the local workspace is empty and not a Git repo.

5. Pulled the reference repository into a temp folder for inspection:
   - `git clone --depth 1 https://github.com/kivvi3412/Claude_Latex_Renderer /tmp/Claude_Latex_Renderer`

6. Inspected the reference repo contents:
   - `rg --files`
   - `sed -n '1,220p' README.md`
   - `sed -n '1,260p' main.js`
   - `sed -n '1,260p' easiest.js`

7. Compared the reference approach with likely desktop implementation paths.

8. Reviewed external documentation for:
   - Claude desktop extensions / local MCP servers
   - Claude connectors and desktop-extension positioning
   - Electron load and script injection hooks

9. Initialized the Node project:
   - `npm init -y`

10. Installed implementation dependencies:
   - `npm install electron esbuild typescript mathjax`

11. Created the initial project scaffold:
   - `.gitignore`
   - `tsconfig.json`
   - `scripts/build.mjs`
   - `src/main.ts`
   - `src/injected.ts`

12. Built and validated the scaffold:
   - `node scripts/build.mjs`
   - `npx tsc --noEmit`

13. Verified the user-facing build command path:
   - `npm run build`

14. Performed the first runtime launch:
   - `npm start`

15. Diagnosed and fixed the Electron startup failure:
   - updated `scripts/build.mjs` to keep `electron` external
   - rebuilt with `npm run build`
   - re-ran typecheck with `npx tsc --noEmit`

16. Performed a second runtime launch and collected renderer diagnostics:
   - `npm start`

17. Diagnosed and fixed the MathJax CSP/font-root issue:
   - switched the copied runtime to the combined local SVG + NewCM entrypoint
   - copied the local SVG font runtime into `dist/vendor/output/fonts/mathjax-newcm/`
   - rooted MathJax's loader path to the local vendor directory
   - improved renderer console forwarding and filtered noisy info logs

18. Rebuilt and validated the updated implementation:
   - `npm run build`
   - `npx tsc --noEmit`

19. Performed a follow-up runtime launch to confirm the previous MathJax CSP error no longer appeared in the next polling window:
   - `npm start`

20. Promoted the MathJax NewCM font package to an explicit dependency:
   - `npm install @mathjax/mathjax-newcm-font`

21. Rebuilt and re-ran typecheck after the dependency hygiene update:
   - `npm run build`
   - `npx tsc --noEmit`

22. Added GitHub publishing polish:
   - created `README.md`
   - created `LICENSE`
   - updated `package.json` metadata for publishing clarity

23. Initialized the local Git repository with `main` as the default branch:
   - `git init -b main`

24. Rebuilt and re-ran typecheck after the publishing pass:
   - `npm run build`
   - `npx tsc --noEmit`

25. Wrote and updated this `implementation.md` file to preserve context and the recommended direction.

## Reference Links Reviewed

- `https://github.com/kivvi3412/Claude_Latex_Renderer/tree/main`
- `https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop`
- `https://claude.com/resources/tutorials/connect-your-tools-to-unlock-a-smarter-more-capable-ai-companion`
- `https://www.electronjs.org/docs/latest/api/web-contents/`

## Assumptions I Am Making

- The target is a desktop experience that behaves like the reference repo, not necessarily a modification of Anthropic's official app binary.
- Speed to first working result matters more than perfect long-term architecture.
- Cross-platform support is desirable, but macOS is likely the first practical target.
- Good math rendering inside Claude conversations is the primary value, not building a general-purpose new AI client on day one.

## Open Questions For The Next Pass

- Do we want a standalone custom desktop shell, or do we want to explicitly target the official Claude Desktop app no matter how brittle that path is?
- Is local-only/private use enough, or do we care about public distribution and signing from the start?
- Do we want to stay Claude-web-account based, or do we want to pivot toward an Anthropic API client later?

## Bottom Line

This project is absolutely feasible.

The most viable version is:

- a custom Electron desktop shell that loads Claude and injects a local LaTeX rendering layer

The least painful strategy is:

- avoid patching the official Claude Desktop app
- avoid full custom-client scope for the first milestone
- ship a narrow rendering-focused MVP first

That is the path I would take from here.
