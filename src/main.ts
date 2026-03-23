import { app, BrowserWindow, net, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CLAUDE_URL = process.env.CLAUDE_URL ?? 'https://claude.ai';
const CLAUDE_PARTITION = process.env.CLAUDE_PARTITION ?? '';
const DEBUG_WINDOW = process.env.DEBUG_CLAUDE_WINDOW === '1';
const LOCAL_ASSET_PREFIX = '/_cldr_assets';
const SHORTCUT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

let cachedInjection: Promise<{ config: string; mathjax: string; injected: string }> | null =
  null;
const configuredSessions = new WeakSet<Electron.Session>();

async function loadInjectionSources() {
  if (!cachedInjection) {
    const distDir = __dirname;
    cachedInjection = Promise.all([
      Promise.resolve(getMathJaxConfig(getLocalAssetRootUrl())),
      readFile(path.join(distDir, 'vendor', 'mathjax.js'), 'utf8'),
      readFile(path.join(distDir, 'injected.js'), 'utf8'),
    ]).then(([config, mathjax, injected]) => ({ config, mathjax, injected }));
  }

  return cachedInjection;
}

function getClaudeOrigin() {
  try {
    return new URL(CLAUDE_URL).origin;
  } catch {
    return 'https://claude.ai';
  }
}

function getLocalAssetRootUrl() {
  return `${getClaudeOrigin()}${LOCAL_ASSET_PREFIX}`;
}

function getMathJaxConfig(assetRootUrl: string) {
  return `
    window.MathJax = {
      loader: {
        paths: {
          mathjax: ${JSON.stringify(assetRootUrl)},
          'mathjax-newcm': ${JSON.stringify(`${assetRootUrl}/mathjax-newcm-font`)}
        }
      },
      startup: {
        typeset: false
      },
      output: {
        font: 'mathjax-newcm'
      },
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
        processEscapes: true
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        ignoreHtmlClass: 'tex2jax_ignore|mathjax_ignore|cldr-math-ignore',
        processHtmlClass: 'cldr-math-force',
        enableMenu: false,
        enableExplorer: false,
        enableComplexity: false,
        enableEnrichment: false,
        enableBraille: false,
        enableSpeech: false
      },
      svg: {
        fontCache: 'none'
      }
    };
  `;
}

function getAssetContentType(filePath: string) {
  switch (path.extname(filePath)) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    default:
      return 'application/octet-stream';
  }
}

function resolveLocalAssetPath(urlString: string) {
  const url = new URL(urlString);
  if (url.origin !== getClaudeOrigin() || !url.pathname.startsWith(`${LOCAL_ASSET_PREFIX}/`)) {
    return null;
  }

  const relativeAssetPath = decodeURIComponent(url.pathname.slice(LOCAL_ASSET_PREFIX.length + 1));
  const vendorDir = path.join(__dirname, 'vendor');
  const assetPath = path.join(vendorDir, relativeAssetPath);
  const relativeToVendor = path.relative(vendorDir, assetPath);

  if (relativeToVendor.startsWith('..') || path.isAbsolute(relativeToVendor)) {
    return null;
  }

  return assetPath;
}

function attachLocalAssetProxy(window: BrowserWindow) {
  const { session } = window.webContents;
  if (configuredSessions.has(session)) {
    return;
  }

  configuredSessions.add(session);
  session.protocol.handle('https', async (request) => {
    const localAssetPath = resolveLocalAssetPath(request.url);
    if (!localAssetPath) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    try {
      const data = await readFile(localAssetPath);
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': getAssetContentType(localAssetPath),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (error) {
      console.error('Failed to serve local asset', localAssetPath, error);
      return new Response('Not found', { status: 404 });
    }
  });
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

  if (!DEBUG_WINDOW) {
    return;
  }

  window.webContents.on('did-start-loading', () => {
    console.log('Page started loading');
  });

  window.webContents.on('did-stop-loading', () => {
    console.log('Page stopped loading', window.webContents.getURL());
  });

  window.webContents.on('did-navigate', (_event, url) => {
    console.log('Navigated', url);
  });

  window.webContents.on('did-navigate-in-page', (_event, url) => {
    console.log('Navigated in page', url);
  });

  window.webContents.on('page-title-updated', (_event, title) => {
    console.log('Page title updated', title);
  });

  window.webContents.on('did-finish-load', () => {
    void window.webContents
      .executeJavaScript(
        `(() => ({
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          bodyChildCount: document.body?.childElementCount ?? 0,
          bodyTextLength: document.body?.innerText?.length ?? 0,
          bodyHtmlPreview: (document.body?.innerHTML ?? '').slice(0, 1200)
        }))();`
      )
      .then((snapshot) => {
        console.log('DOM snapshot after load', snapshot);
      })
      .catch((error) => {
        console.error('Failed to capture DOM snapshot', error);
      });
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
      ...(CLAUDE_PARTITION ? { partition: CLAUDE_PARTITION } : {}),
    },
  });

  attachWindowDiagnostics(window);
  attachKeyboardShortcuts(window);
  attachNavigationBehavior(window);
  attachLocalAssetProxy(window);

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
