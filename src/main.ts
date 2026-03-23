import { app, BrowserWindow, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CLAUDE_URL = process.env.CLAUDE_URL ?? 'https://claude.ai';
const SHORTCUT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

let cachedInjection: Promise<{ config: string; mathjax: string; injected: string }> | null =
  null;

async function loadInjectionSources() {
  if (!cachedInjection) {
    const distDir = __dirname;
    cachedInjection = Promise.all([
      Promise.resolve(getMathJaxConfig(pathToFileURL(path.join(distDir, 'vendor')).href)),
      readFile(path.join(distDir, 'vendor', 'mathjax.js'), 'utf8'),
      readFile(path.join(distDir, 'injected.js'), 'utf8'),
    ]).then(([config, mathjax, injected]) => ({ config, mathjax, injected }));
  }

  return cachedInjection;
}

function getMathJaxConfig(mathjaxRootUrl: string) {
  return `
    window.MathJax = {
      loader: {
        paths: {
          mathjax: ${JSON.stringify(mathjaxRootUrl)}
        }
      },
      startup: {
        typeset: false
      },
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
        processEscapes: true
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        ignoreHtmlClass: 'tex2jax_ignore|mathjax_ignore|cldr-math-ignore',
        processHtmlClass: 'cldr-math-force'
      },
      svg: {
        fontCache: 'local'
      }
    };
  `;
}

async function injectEnhancements(window: BrowserWindow) {
  const { config, mathjax, injected } = await loadInjectionSources();

  await window.webContents.executeJavaScript(config);
  await window.webContents.executeJavaScript(mathjax);
  await window.webContents.executeJavaScript(injected);
}

async function triggerManualRender(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'window.__CLAUDE_LATEX_RENDERER__?.forceRender?.();'
  );
}

function getClaudeLikeUserAgent(window: BrowserWindow) {
  return window.webContents
    .getUserAgent()
    .replace(/\sElectron\/[^\s]+/g, '')
    .trim();
}

function isWebUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function attachWindowDiagnostics(window: BrowserWindow) {
  window.webContents.on('console-message', (details) => {
    const { level, lineNumber, message, sourceId } = details;
    const isRendererLog = message.includes('[claude-latex-renderer]');
    const isInteresting = isRendererLog || level === 'warning' || level === 'error';

    if (!isInteresting) {
      return;
    }

    const source = sourceId ? `${sourceId}:${lineNumber}` : `line ${lineNumber}`;
    console.log(`[renderer:${level}] ${source} ${message}`);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('Page failed to load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    }
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited', details);
  });
}

function attachKeyboardShortcuts(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    const modifierPressed = input.meta || input.control;

    if (modifierPressed && input.shift && input.key.toLowerCase() === 'm') {
      event.preventDefault();
      void triggerManualRender(window).catch((error) => {
        console.error('Manual math render failed', error);
      });
      return;
    }

    if (modifierPressed && input.shift && input.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if (modifierPressed && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      window.webContents.reloadIgnoringCache();
    }
  });
}

function attachNavigationBehavior(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      console.log('Allowing popup window', url);
      return { action: 'allow' };
    }

    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) {
      console.log('Navigating in app', url);
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    title: 'Claude LaTeX Renderer',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: 'persist:claude-latex-renderer',
    },
  });

  attachWindowDiagnostics(window);
  attachKeyboardShortcuts(window);
  attachNavigationBehavior(window);

  window.webContents.setUserAgent(getClaudeLikeUserAgent(window));

  window.webContents.on('dom-ready', () => {
    void injectEnhancements(window).catch((error) => {
      console.error('Failed to inject LaTeX renderer', error);
    });
  });

  void window.loadURL(CLAUDE_URL);

  return window;
}

app.whenReady().then(() => {
  console.log(
    `Claude LaTeX Renderer ready. Shortcuts: ${SHORTCUT_MODIFIER}+Shift+M render, ${SHORTCUT_MODIFIER}+Shift+D devtools, ${SHORTCUT_MODIFIER}+Shift+R hard reload.`
  );

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
