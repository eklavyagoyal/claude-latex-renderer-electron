type RendererState = {
  forceRender: () => void;
  isAutoRenderEnabled: () => boolean;
  observer: MutationObserver;
  setAutoRender: (enabled: boolean) => void;
};

declare global {
  interface Window {
    MathJax?: {
      startup?: {
        promise?: Promise<unknown>;
      };
      typesetPromise?: (elements?: Element[]) => Promise<unknown>;
      typesetClear?: (elements?: Element[]) => void;
    };
    __CLAUDE_LATEX_RENDERER__?: RendererState;
  }
}

const BUTTON_ID = 'cldr-render-button';
const BUTTON_ATTR = 'data-cldr-render-button';
const STYLE_ID = 'cldr-render-styles';
const STORAGE_KEY = 'cldr-auto-render';
const SKIP_SELECTOR =
  'pre, code, textarea, input, select, option, button, svg, mjx-container, .MathJax, [contenteditable="true"]';
const CANDIDATE_SELECTOR =
  'p, li, div, span, blockquote, section, article, td, th, h1, h2, h3, h4, h5, h6';
const MAX_WAIT_ATTEMPTS = 40;
const WAIT_INTERVAL_MS = 150;

(() => {
  if (window.__CLAUDE_LATEX_RENDERER__) {
    window.__CLAUDE_LATEX_RENDERER__.forceRender();
    return;
  }

  const pending = new Set<Element>();
  let flushTimer: number | null = null;
  let isRendering = false;
  let isObserverActive = false;
  let autoRenderEnabled = readAutoRenderPreference();

  function log(message: string, error?: unknown) {
    if (error) {
      console.error(`[claude-latex-renderer] ${message}`, error);
      return;
    }

    console.debug(`[claude-latex-renderer] ${message}`);
  }

  function readAutoRenderPreference() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  function writeAutoRenderPreference(enabled: boolean) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch (error) {
      log('Failed to persist auto-render preference', error);
    }
  }

  function containsMathSyntax(text: string) {
    return (
      text.includes('$$') ||
      text.includes('\\(') ||
      text.includes('\\[') ||
      /(^|[^\\])\$[^$\n]/m.test(text)
    );
  }

  function isIgnoredElement(element: Element | null) {
    return Boolean(element?.closest(SKIP_SELECTOR)) || element?.hasAttribute(BUTTON_ATTR) === true;
  }

  function getScanRoot() {
    return document.querySelector('main') ?? document.body;
  }

  function getCandidateContainer(element: Element | null): Element | null {
    if (!element || isIgnoredElement(element)) {
      return null;
    }

    let current: Element | null = element;

    while (current && current !== document.body) {
      if (isIgnoredElement(current)) {
        return null;
      }

      const text = current.textContent?.trim() ?? '';
      if (text && containsMathSyntax(text) && current.matches(CANDIDATE_SELECTOR)) {
        return current;
      }

      current = current.parentElement;
    }

    const fallback = element.closest(CANDIDATE_SELECTOR);
    if (!fallback || isIgnoredElement(fallback)) {
      return null;
    }

    return containsMathSyntax(fallback.textContent ?? '') ? fallback : null;
  }

  function getNodeDepth(element: Element) {
    let depth = 0;
    let current: Element | null = element;

    while (current) {
      depth += 1;
      current = current.parentElement;
    }

    return depth;
  }

  function collapseCandidates(elements: Iterable<Element>) {
    const ordered = Array.from(new Set(elements)).sort((left, right) => {
      if (left === right) {
        return 0;
      }

      const depthDifference = getNodeDepth(left) - getNodeDepth(right);
      if (depthDifference !== 0) {
        return depthDifference;
      }

      const position = left.compareDocumentPosition(right);
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }

      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }

      return 0;
    });

    return ordered.filter((candidate, index) => {
      for (let i = 0; i < index; i += 1) {
        if (ordered[i].contains(candidate)) {
          return false;
        }
      }

      return true;
    });
  }

  function queueCandidate(candidate: Element | null) {
    if (!candidate || !containsMathSyntax(candidate.textContent ?? '')) {
      return;
    }

    pending.add(candidate);
  }

  function queueFromNode(node: Node | null) {
    if (!node) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!containsMathSyntax(text)) {
        return;
      }

      queueCandidate(getCandidateContainer(node.parentElement));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    if (isIgnoredElement(element)) {
      return;
    }

    if (containsMathSyntax(element.textContent ?? '')) {
      queueCandidate(getCandidateContainer(element));
      return;
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (containsMathSyntax(textNode.textContent ?? '')) {
        queueCandidate(getCandidateContainer(textNode.parentElement));
      }
    }
  }

  function scanTree(root: ParentNode) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      queueFromNode(walker.currentNode);
    }
  }

  async function flushPending() {
    flushTimer = null;

    if (isRendering || pending.size === 0) {
      return;
    }

    const mathJax = window.MathJax;
    if (!mathJax?.typesetPromise) {
      return;
    }

    isRendering = true;
    const targets = collapseCandidates(pending);
    pending.clear();

    try {
      for (const target of targets) {
        mathJax.typesetClear?.([target]);
        await mathJax.typesetPromise([target]);
      }
    } catch (error) {
      log('Math typesetting failed', error);
    } finally {
      isRendering = false;
      if (pending.size > 0 && flushTimer === null) {
        flushTimer = window.setTimeout(() => {
          void flushPending();
        }, 200);
      }
    }
  }

  function scheduleFlush(delay = 120) {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
    }

    flushTimer = window.setTimeout(() => {
      void flushPending();
    }, delay);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      mjx-container[jax="SVG"] {
        white-space: normal;
        overflow-x: auto;
        overflow-y: hidden;
        max-width: 100%;
      }

      mjx-container[jax="SVG"] > svg {
        max-width: 100%;
        height: auto;
      }

      mjx-container[display="true"] {
        margin: 0.85rem 0 !important;
        padding: 0.05rem 0;
      }

      #${BUTTON_ID} {
        backdrop-filter: blur(14px);
      }
    `;

    document.head.appendChild(style);
  }

  function syncObserver() {
    if (!document.body) {
      return;
    }

    if (autoRenderEnabled && !isObserverActive) {
      observer.observe(document.body, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      isObserverActive = true;
      return;
    }

    if (!autoRenderEnabled && isObserverActive) {
      observer.disconnect();
      isObserverActive = false;
    }
  }

  function ensureButton(state: RendererState) {
    let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;

    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.setAttribute(BUTTON_ATTR, 'true');
      button.style.position = 'fixed';
      button.style.right = '20px';
      button.style.bottom = '20px';
      button.style.zIndex = '2147483647';
      button.style.padding = '10px 14px';
      button.style.border = '1px solid rgba(15, 23, 42, 0.18)';
      button.style.borderRadius = '999px';
      button.style.background = 'rgba(255, 255, 255, 0.94)';
      button.style.color = '#0f172a';
      button.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.12)';
      button.style.cursor = 'pointer';
      button.style.font =
        '600 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
      button.addEventListener('click', (event) => {
        if (event.shiftKey) {
          state.setAutoRender(!state.isAutoRenderEnabled());
          return;
        }

        state.forceRender();
      });

      document.body.appendChild(button);
    }

    button.textContent = autoRenderEnabled ? 'Render math · auto' : 'Render math · manual';
    button.title =
      'Click to typeset visible math. Shift-click to toggle automatic rendering.';
    button.style.opacity = autoRenderEnabled ? '1' : '0.82';
  }

  async function waitForMathJax() {
    for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
      const startupPromise = window.MathJax?.startup?.promise;
      if (startupPromise) {
        await startupPromise;
      }

      if (window.MathJax?.typesetPromise) {
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, WAIT_INTERVAL_MS);
      });
    }

    return false;
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        queueFromNode(mutation.target);
      }

      mutation.addedNodes.forEach((node) => {
        queueFromNode(node);
      });
    }

    if (pending.size > 0) {
      scheduleFlush();
    }
  });

  const state: RendererState = {
    observer,
    forceRender: () => {
      const root = getScanRoot();
      if (!root) {
        return;
      }

      scanTree(root);
      scheduleFlush(10);
    },
    isAutoRenderEnabled: () => autoRenderEnabled,
    setAutoRender: (enabled) => {
      autoRenderEnabled = enabled;
      writeAutoRenderPreference(enabled);
      ensureButton(state);
      syncObserver();
      log(`Auto-render ${enabled ? 'enabled' : 'disabled'}`);
    },
  };

  window.__CLAUDE_LATEX_RENDERER__ = state;

  void (async () => {
    const ready = await waitForMathJax();
    if (!ready) {
      log('MathJax never became ready');
      return;
    }

    ensureStyles();
    ensureButton(state);

    state.forceRender();
    window.setTimeout(() => {
      state.forceRender();
    }, 1200);

    syncObserver();
  })();
})();
