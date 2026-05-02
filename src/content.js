/**
 * Redium — Reddit post pages → Medium-ish reader.
 * Runs at document_start; waits for shreddit-* components, then renders #redium-root.
 *
 * Build for Chrome: `npm run build` → loads bundled `dist/content.js` (manifest).
 */
import {
  isExtensionRuntimeAlive,
  safeExtensionGetUrl,
} from "./lib/extension-runtime.js";

(function () {
  "use strict";

  /** Debounce for full comment-tree rebuild (lazy-loaded replies); score-only updates bypass this. */
  const DEBOUNCE_MS = 380;
  const EXPAND_INTERVAL_MS = 1200;

  /**
   * @param {string} selector
   * @param {ParentNode} [root]
   * @param {number} [timeoutMs]
   * @returns {Promise<Element|null>}
   */
  function waitFor(selector, root, timeoutMs) {
    const doc = root || document;
    const deadline = Date.now() + (timeoutMs || 60000);
    return new Promise(function (resolve) {
      function tick() {
        const el = doc.querySelector(selector);
        if (el) {
          resolve(el);
          return;
        }
        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  /**
   * @param {Element} el
   * @param {string[]} selectors
   * @returns {Element|null}
   */
  function firstMatch(el, selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const q = selectors[i];
      const found = el.querySelector(q);
      if (found) return found;
      if (el.shadowRoot) {
        const f2 = el.shadowRoot.querySelector(q);
        if (f2) return f2;
      }
    }
    return null;
  }

  /**
   * @param {Element} postEl
   * @returns {{ title: string, author: string, subreddit: string, createdLabel: string, score: string, bodyHtml: string, permalink: string }}
   */
  function extractPost(postEl) {
    const titleLink = firstMatch(postEl, [
      'a[slot="title"]',
      'h1 a',
      '[slot="title"]',
    ]);
    let title =
      (titleLink && titleLink.textContent && titleLink.textContent.trim()) ||
      postEl.getAttribute("post-title") ||
      postEl.getAttribute("headline") ||
      "";

    const author = postEl.getAttribute("author") || "";
    const subreddit =
      postEl.getAttribute("subreddit-prefixed-name") ||
      postEl.getAttribute("subreddit-name") ||
      "";
    const ts = postEl.getAttribute("created-timestamp");
    let createdLabel = "";
    if (ts) {
      const n = Number(ts);
      if (!Number.isNaN(n)) {
        const d = new Date(n < 1e12 ? n * 1000 : n);
        if (!Number.isNaN(d.getTime())) createdLabel = d.toLocaleString();
      }
    }
    const score = postEl.getAttribute("score") || "";

    const bodySlot = firstMatch(postEl, [
      'div[slot="text-body"]',
      '[slot="text-body"]',
    ]);
    let bodyHtml = bodySlot ? bodySlot.innerHTML : "";

    if (!bodyHtml.trim()) {
      const media = firstMatch(postEl, [
        '[slot="post-media-container"]',
        '[slot="gallery"]',
        "shreddit-aspect-ratio",
      ]);
      if (media) bodyHtml = media.outerHTML;
    }

    const fullLink = firstMatch(postEl, [
      'a[slot="full-post-link"]',
      'a[data-click-id="body"]',
    ]);
    const permalink =
      (fullLink && fullLink.getAttribute("href")) ||
      postEl.getAttribute("permalink") ||
      window.location.pathname;

    if (!title && permalink) {
      const parts = permalink.split("/");
      const slug = parts[parts.length - 1] || "";
      if (slug) title = decodeURIComponent(slug.replace(/_/g, " "));
    }

    return {
      title: title || "Post",
      author,
      subreddit,
      createdLabel,
      score,
      bodyHtml,
      permalink: permalink.startsWith("http") ? permalink : "https://www.reddit.com" + permalink,
    };
  }

  /**
   * @param {Element} el
   * @returns {string}
   */
  function extractCommentBodyHtml(el) {
    const slot = firstMatch(el, [
      '[slot="comment"]',
      "faceplate-markdown",
      ".md",
      '[data-testid="comment"]',
    ]);
    if (slot) return slot.innerHTML;
    const paras = el.querySelectorAll(":scope > p");
    if (paras.length) {
      let html = "";
      paras.forEach(function (p) {
        html += p.outerHTML;
      });
      return html;
    }
    return "";
  }

  /**
   * @param {Element} el
   * @returns {string}
   */
  function extractCommentTime(el) {
    const t = el.querySelector("time[datetime]");
    if (!t) return "";
    const dt = t.getAttribute("datetime");
    if (!dt) return "";
    const d = new Date(dt);
    return Number.isNaN(d.getTime()) ? dt : d.toLocaleString();
  }

  /**
   * @param {Element} el
   * @returns {{ id: string, depth: number, author: string, score: string, timeLabel: string, bodyHtml: string, permalink: string }}
   */
  function extractComment(el) {
    const id =
      el.getAttribute("thingid") ||
      el.getAttribute("comment-id") ||
      el.id ||
      el.getAttribute("permalink") ||
      String(Math.random());
    const depth = parseInt(el.getAttribute("depth") || "0", 10) || 0;
    const author = el.getAttribute("author") || "[deleted]";
    const score = el.getAttribute("score") || "";
    return {
      id,
      depth,
      author,
      score,
      timeLabel: extractCommentTime(el),
      bodyHtml: extractCommentBodyHtml(el),
      permalink: el.getAttribute("permalink") || "",
    };
  }

  /**
   * @param {NodeListOf<Element>|Element[]} domNodes
   * @returns {Array<{ id: string, depth: number, author: string, score: string, timeLabel: string, bodyHtml: string, permalink: string, sourceEl: Element, children: any[] }>}
   */
  function buildCommentTree(domNodes) {
    const roots = [];
    /** @type {{ depth: number, item: any }[]} */
    const stack = [];

    domNodes.forEach(function (el) {
      const data = extractComment(el);
      const item = {
        id: data.id,
        depth: data.depth,
        author: data.author,
        score: data.score,
        timeLabel: data.timeLabel,
        bodyHtml: data.bodyHtml,
        permalink: data.permalink,
        sourceEl: el,
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].depth >= data.depth) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(item);
      } else {
        stack[stack.length - 1].item.children.push(item);
      }

      stack.push({ depth: data.depth, item: item });
    });

    return roots;
  }

  /**
   * @param {Element} treeEl
   * @returns {any[]}
   */
  function extractCommentsFromTree(treeEl) {
    const list = treeEl.querySelectorAll("shreddit-comment");
    return buildCommentTree(list);
  }

  /**
   * @param {string} raw
   * @returns {string}
   */
  function redditSubUrl(raw) {
    if (!raw) return "";
    const name = String(raw).replace(/^r\//i, "").trim();
    if (!name) return "";
    return "https://www.reddit.com/r/" + encodeURIComponent(name) + "/";
  }

  /**
   * @param {string} author
   * @returns {string}
   */
  function redditUserUrl(author) {
    if (!author || author === "[deleted]") return "";
    return (
      "https://www.reddit.com/user/" + encodeURIComponent(author) + "/"
    );
  }

  /** Medium-style clap icon (same path as Medium); display-only next to score. */
  var REDIUM_CLAP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" fill-rule="evenodd" d="M11.37.828 12 3.282l.63-2.454zM13.916 3.953l1.523-2.112-1.184-.39zM8.589 1.84l1.522 2.112-.337-2.501zM18.523 18.92c-.86.86-1.75 1.246-2.62 1.33a6 6 0 0 0 .407-.372c2.388-2.389 2.86-4.951 1.399-7.623l-.912-1.603-.79-1.672c-.26-.56-.194-.98.203-1.288a.7.7 0 0 1 .546-.132c.283.046.546.231.728.5l2.363 4.157c.976 1.624 1.141 4.237-1.324 6.702m-10.999-.438L3.37 14.328a.828.828 0 0 1 .585-1.408.83.83 0 0 1 .585.242l2.158 2.157a.365.365 0 0 0 .516-.516l-2.157-2.158-1.449-1.449a.826.826 0 0 1 1.167-1.17l3.438 3.44a.363.363 0 0 0 .516 0 .364.364 0 0 0 0-.516L5.293 9.513l-.97-.97a.826.826 0 0 1 0-1.166.84.84 0 0 1 1.167 0l.97.968 3.437 3.436a.36.36 0 0 0 .517 0 .366.366 0 0 0 0-.516L6.977 7.83a.82.82 0 0 1-.241-.584.82.82 0 0 1 .824-.826c.219 0 .43.087.584.242l5.787 5.787a.366.366 0 0 0 .587-.415l-1.117-2.363c-.26-.56-.194-.98.204-1.289a.7.7 0 0 1 .546-.132c.283.046.545.232.727.501l2.193 3.86c1.302 2.38.883 4.59-1.277 6.75-1.156 1.156-2.602 1.627-4.19 1.367-1.418-.236-2.866-1.033-4.079-2.246M10.75 5.971l2.12 2.12c-.41.502-.465 1.17-.128 1.89l.22.465-3.523-3.523a.8.8 0 0 1-.097-.368c0-.22.086-.428.241-.584a.847.847 0 0 1 1.167 0m7.355 1.705c-.31-.461-.746-.758-1.23-.837a1.44 1.44 0 0 0-1.11.275c-.312.24-.505.543-.59.881a1.74 1.74 0 0 0-.906-.465 1.47 1.47 0 0 0-.82.106l-2.182-2.182a1.56 1.56 0 0 0-2.2 0 1.54 1.54 0 0 0-.396.701 1.56 1.56 0 0 0-2.21-.01 1.55 1.55 0 0 0-.416.753c-.624-.624-1.649-.624-2.237-.037a1.557 1.557 0 0 0 0 2.2c-.239.1-.501.238-.715.453a1.56 1.56 0 0 0 0 2.2l.516.515a1.556 1.556 0 0 0-.753 2.615L7.01 19c1.32 1.319 2.909 2.189 4.475 2.449q.482.08.971.08c.85 0 1.653-.198 2.393-.579.231.033.46.054.686.054 1.266 0 2.457-.52 3.505-1.567 2.763-2.763 2.552-5.734 1.439-7.586z" clip-rule="evenodd"></path>' +
    "</svg>";

  /**
   * Clone an SVG from Reddit's comment UI for the thread expand affordance (never assign raw HTML — Trusted Types).
   * @param {Element | null} treeEl
   * @returns {SVGElement|null}
   */
  function tryCloneRedditExpandGlyph(treeEl) {
    if (!treeEl) return null;
    var btns = treeEl.querySelectorAll("shreddit-comment button");
    var i;
    var lab;
    for (i = 0; i < btns.length; i++) {
      lab = (btns[i].getAttribute("aria-label") || "").toLowerCase();
      if (
        lab.indexOf("more repl") !== -1 ||
        lab.indexOf("continue thread") !== -1 ||
        lab.indexOf("continue this thread") !== -1 ||
        lab.indexOf("view more repl") !== -1 ||
        (lab.indexOf("expand") !== -1 && lab.indexOf("comment") !== -1)
      ) {
        var svg = btns[i].querySelector("svg");
        if (svg) return /** @type {SVGElement} */ (svg.cloneNode(true));
      }
    }
    var fp = treeEl.querySelector(
      "shreddit-comment faceplate-icon svg, shreddit-comment faceplate-icon svg"
    );
    if (fp) return /** @type {SVGElement} */ (fp.cloneNode(true));
    return null;
  }

  /**
   * @returns {SVGElement}
   */
  function createFallbackCirclePlusSvg() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("redium-thread-svg-glyph");
    var c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "12");
    c.setAttribute("cy", "12");
    c.setAttribute("r", "9");
    c.setAttribute("stroke", "currentColor");
    c.setAttribute("stroke-width", "1.5");
    svg.appendChild(c);
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M12 8v8M8 12h8");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.5");
    p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    return svg;
  }

  /**
   * @returns {SVGElement}
   */
  function createFallbackCircleMinusSvg() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("redium-thread-svg-glyph");
    var c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "12");
    c.setAttribute("cy", "12");
    c.setAttribute("r", "9");
    c.setAttribute("stroke", "currentColor");
    c.setAttribute("stroke-width", "1.5");
    svg.appendChild(c);
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M8 12h8");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.5");
    p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    return svg;
  }

  /**
   * @param {SVGElement | null} redditExpandGlyph Template from Reddit or null
   * @returns {HTMLSpanElement}
   */
  function buildThreadToggleIcons(redditExpandGlyph) {
    var wrap = document.createElement("span");
    wrap.className = "redium-thread-toggle-icons";

    var plusWrap = document.createElement("span");
    plusWrap.className = "redium-thread-icon-plus";
    if (redditExpandGlyph) {
      plusWrap.appendChild(redditExpandGlyph.cloneNode(true));
    } else {
      plusWrap.appendChild(createFallbackCirclePlusSvg());
    }

    var minusWrap = document.createElement("span");
    minusWrap.className = "redium-thread-icon-minus";
    minusWrap.appendChild(createFallbackCircleMinusSvg());

    wrap.appendChild(plusWrap);
    wrap.appendChild(minusWrap);
    return wrap;
  }

  /**
   * Keep post score text in sync with live `shreddit-post` `score` attribute.
   * @param {Element} postSourceEl
   * @param {HTMLElement} countEl
   */
  function wirePostScoreSync(postSourceEl, countEl) {
    function syncScore() {
      if (!countEl || !postSourceEl) return;
      var s = postSourceEl.getAttribute("score");
      if (s !== null && s !== "") countEl.textContent = s;
      var wrap = countEl.parentElement;
      if (wrap && wrap.classList.contains("redium-clap-readonly")) {
        wrap.setAttribute(
          "aria-label",
          "Post score: " + (s !== null && s !== "" ? s : "—")
        );
      }
    }
    syncScore();
    if (readerState.postScoreMo) {
      readerState.postScoreMo.disconnect();
      readerState.postScoreMo = null;
    }
    readerState.postScoreMo = new MutationObserver(syncScore);
    readerState.postScoreMo.observe(postSourceEl, {
      attributes: true,
      attributeFilter: ["score"],
    });
  }

  /**
   * Stable key for mapping live `shreddit-comment` ↔ reader score UI (must match `extractComment` ids).
   * @param {Element | null} sourceEl
   * @param {string} fallbackId
   * @returns {string}
   */
  function commentScoreKey(sourceEl, fallbackId) {
    if (sourceEl && sourceEl.getAttribute) {
      var tid =
        sourceEl.getAttribute("thingid") ||
        sourceEl.getAttribute("comment-id") ||
        sourceEl.id ||
        sourceEl.getAttribute("permalink") ||
        "";
      if (tid) return tid;
    }
    return String(fallbackId || "");
  }

  /**
   * @param {Element | null} com
   * @returns {string}
   */
  function commentScoreKeyFromCommentEl(com) {
    return commentScoreKey(com, "");
  }

  /**
   * @param {{ countEl: HTMLElement, wrapEl: HTMLElement }} ui
   * @param {Element} shredditCommentEl
   */
  function applyCommentScoreUi(ui, shredditCommentEl) {
    if (!ui || !shredditCommentEl) return;
    var s = shredditCommentEl.getAttribute("score");
    if (s !== null && s !== "") ui.countEl.textContent = s;
    if (ui.wrapEl && ui.wrapEl.classList.contains("redium-clap-readonly")) {
      ui.wrapEl.setAttribute(
        "aria-label",
        "Comment score: " + (s !== null && s !== "" ? s : "—")
      );
    }
  }

  /**
   * Register one comment row for incremental score sync (single tree observer; no per-comment MO).
   * @param {Element | null} sourceEl Live `shreddit-comment`
   * @param {string} fallbackId
   * @param {HTMLElement} countEl
   * @param {HTMLElement} wrapEl
   */
  function registerCommentScoreUi(sourceEl, fallbackId, countEl, wrapEl) {
    if (!sourceEl) return;
    var key = commentScoreKey(sourceEl, fallbackId);
    if (!key) return;
    var ui = { countEl: countEl, wrapEl: wrapEl };
    readerState.commentScoreUiByKey.set(key, ui);
    applyCommentScoreUi(ui, sourceEl);
  }

  /**
   * @param {{ title: string, author: string, subreddit: string, createdLabel: string, score: string, bodyHtml: string, permalink: string }} post
   * @param {Element | null} [postSourceEl] Live `shreddit-post` for score sync
   * @returns {DocumentFragment}
   */
  function renderPost(post, postSourceEl) {
    const frag = document.createDocumentFragment();
    const wrap = document.createElement("div");
    wrap.className = "redium-inner";

    const h1 = document.createElement("h1");
    h1.className = "redium-post-title";
    h1.textContent = post.title;

    const meta = document.createElement("div");
    meta.className = "redium-post-meta";
    const line = document.createElement("span");

    function appendSep() {
      line.appendChild(document.createTextNode(" · "));
    }

    let needSep = false;
    if (post.subreddit) {
      const href = redditSubUrl(post.subreddit);
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.rel = "noreferrer noopener";
        const label = /^r\//i.test(post.subreddit)
          ? post.subreddit
          : "r/" + post.subreddit.replace(/^r\//i, "");
        a.textContent = label;
        line.appendChild(a);
        needSep = true;
      }
    }
    if (post.author) {
      const href = redditUserUrl(post.author);
      if (href) {
        if (needSep) appendSep();
        const a = document.createElement("a");
        a.href = href;
        a.rel = "noreferrer noopener";
        a.textContent = "u/" + post.author;
        line.appendChild(a);
        needSep = true;
      }
    }
    if (postSourceEl) {
      if (needSep) appendSep();
      var clapWrap = document.createElement("span");
      clapWrap.className = "redium-clap-inline redium-clap-readonly";
      clapWrap.setAttribute("title", "Score (read-only)");
      clapWrap.setAttribute(
        "aria-label",
        "Post score: " +
          (post.score !== undefined && post.score !== "" ? String(post.score) : "—")
      );
      var clapIcon = document.createElement("span");
      clapIcon.className = "redium-clap-btn";
      clapIcon.setAttribute("aria-hidden", "true");
      clapIcon.innerHTML = REDIUM_CLAP_SVG;
      var clapCount = document.createElement("span");
      clapCount.className = "redium-clap-count";
      clapCount.textContent =
        post.score !== undefined && post.score !== "" ? String(post.score) : "—";
      clapWrap.appendChild(clapIcon);
      clapWrap.appendChild(clapCount);
      line.appendChild(clapWrap);
      needSep = true;
      wirePostScoreSync(postSourceEl, clapCount);
    } else if (post.score) {
      if (needSep) appendSep();
      line.appendChild(document.createTextNode(post.score + " pts"));
      needSep = true;
    }
    if (post.createdLabel) {
      if (needSep) appendSep();
      line.appendChild(document.createTextNode(post.createdLabel));
    }

    meta.appendChild(line);

    const body = document.createElement("div");
    body.className = "redium-post-body";
    if (post.bodyHtml && post.bodyHtml.trim()) {
      body.innerHTML = post.bodyHtml;
    } else {
      const muted = document.createElement("p");
      muted.className = "redium-muted";
      muted.textContent = "No text in this post (link or media only).";
      body.appendChild(muted);
      const out = document.createElement("a");
      out.className = "redium-link-out";
      out.href = post.permalink;
      out.textContent = "View post on Reddit";
      out.rel = "noreferrer noopener";
      body.appendChild(out);
    }

    wrap.appendChild(h1);
    wrap.appendChild(meta);
    wrap.appendChild(body);
    frag.appendChild(wrap);
    return frag;
  }

  /**
   * @param {any} node
   * @param {number} depth
   * @param {SVGElement | null} [redditExpandGlyph] cloned Reddit expand SVG template (optional)
   * @returns {HTMLElement}
   */
  function renderCommentNode(node, depth, redditExpandGlyph) {
    const div = document.createElement("div");
    div.className = "redium-comment";
    div.setAttribute("data-depth", String(depth));
    div.dataset.commentId = node.id;

    const header = document.createElement("div");
    header.className = "redium-comment-header";

    const strong = document.createElement("strong");
    strong.textContent = "u/" + node.author;
    header.appendChild(strong);

    header.appendChild(document.createTextNode(" · "));

    const scoreStr =
      node.score !== undefined && node.score !== "" ? String(node.score) : "—";
    const clapWrap = document.createElement("span");
    clapWrap.className =
      "redium-clap-inline redium-clap-readonly redium-clap-comment";
    clapWrap.setAttribute("title", "Score (read-only)");
    clapWrap.setAttribute("aria-label", "Comment score: " + scoreStr);
    const clapIcon = document.createElement("span");
    clapIcon.className = "redium-clap-btn";
    clapIcon.setAttribute("aria-hidden", "true");
    clapIcon.innerHTML = REDIUM_CLAP_SVG;
    const clapCount = document.createElement("span");
    clapCount.className = "redium-clap-count";
    clapCount.textContent = scoreStr;
    clapWrap.appendChild(clapIcon);
    clapWrap.appendChild(clapCount);
    header.appendChild(clapWrap);

    if (node.sourceEl) {
      registerCommentScoreUi(node.sourceEl, node.id, clapCount, clapWrap);
    }

    if (node.timeLabel) {
      header.appendChild(document.createTextNode(" · "));
      header.appendChild(document.createTextNode(node.timeLabel));
    }

    const body = document.createElement("div");
    body.className = "redium-comment-body";
    if (node.bodyHtml && node.bodyHtml.trim()) {
      body.innerHTML = node.bodyHtml;
    } else {
      const m = document.createElement("span");
      m.className = "redium-muted";
      m.textContent = "[empty or unavailable]";
      body.appendChild(m);
    }

    div.appendChild(header);
    div.appendChild(body);

    if (node.children && node.children.length) {
      const n = node.children.length;
      const replyWord = n === 1 ? "reply" : "replies";

      const toggleRow = document.createElement("div");
      toggleRow.className = "redium-comment-collapse-row";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "redium-thread-toggle";
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.setAttribute(
        "aria-label",
        "Collapse " + n + " " + replyWord
      );
      toggleBtn.appendChild(buildThreadToggleIcons(redditExpandGlyph));

      const kids = document.createElement("div");
      kids.className = "redium-children";

      toggleBtn.addEventListener("click", function (e) {
        e.preventDefault();
        const exp = toggleBtn.getAttribute("aria-expanded") === "true";
        const nextExpanded = !exp;
        toggleBtn.setAttribute(
          "aria-expanded",
          nextExpanded ? "true" : "false"
        );
        kids.classList.toggle("redium-children-collapsed", !nextExpanded);
        toggleBtn.setAttribute(
          "aria-label",
          (nextExpanded ? "Collapse " : "Expand ") + n + " " + replyWord
        );
      });

      for (let i = 0; i < node.children.length; i++) {
        kids.appendChild(
          renderCommentNode(node.children[i], depth + 1, redditExpandGlyph)
        );
      }

      toggleRow.appendChild(toggleBtn);
      div.appendChild(toggleRow);
      div.appendChild(kids);
    }

    return div;
  }

  /**
   * @param {any[]} roots
   * @param {Element | null} treeEl Live comment tree (for cloning Reddit expand icon)
   * @returns {HTMLElement}
   */
  function renderCommentsSection(roots, treeEl) {
    const section = document.createElement("section");
    section.className = "redium-inner redium-comments-wrap";

    const h2 = document.createElement("h2");
    h2.className = "redium-comments-heading";
    h2.textContent = "Comments";

    const redditExpandGlyph = tryCloneRedditExpandGlyph(treeEl);

    const container = document.createElement("div");
    container.id = "redium-comments-root";
    for (let i = 0; i < roots.length; i++) {
      container.appendChild(renderCommentNode(roots[i], 0, redditExpandGlyph));
    }

    section.appendChild(h2);
    section.appendChild(container);
    return section;
  }

  /**
   * @param {Element} treeEl
   */
  function autoExpandMoreReplies(treeEl) {
    const candidates = treeEl.querySelectorAll(
      'button, a[role="button"], faceplate-tracker a, shreddit-comment-action-row a'
    );
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const text = (el.textContent || "").trim().toLowerCase();
      if (
        text.includes("more repl") ||
        text.includes("more comment") ||
        text.includes("continue this thread") ||
        text === "view more comments" ||
        text.includes("load more")
      ) {
        try {
          el.click();
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  const STORAGE_KEY = "rediumReaderOn";
  const THEME_KEY = "rediumTheme";
  /** @type {readonly ["white", "sepia", "black"]} */
  const THEME_IDS = ["white", "sepia", "black"];

  let readerKeyboardShortcutInstalled = false;
  let toggleOutsideCloseInstalled = false;

  /** Bumped on each `main()` so stale async callbacks exit early after navigation / re-toggle. */
  let mainGeneration = 0;
  /** Canonical `/r/.../comments/...` path after a successful build (lowercase). */
  let lastBuiltPostPath = "";

  const readerState = {
    treeEl: /** @type {Element | null} */ (null),
    commentsMount: /** @type {Element | null} */ (null),
    obs: /** @type {MutationObserver | null} */ (null),
    expandId: /** @type {ReturnType<typeof setInterval> | null} */ (null),
    debounceTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    postScoreMo: /** @type {MutationObserver | null} */ (null),
    /** Maps stable comment id → clap UI for incremental score updates (one tree observer). */
    commentScoreUiByKey: /** @type {Map<string, { countEl: HTMLElement, wrapEl: HTMLElement }>} */ (
      new Map()
    ),
  };

  function clearCommentScoreRegistry() {
    readerState.commentScoreUiByKey.clear();
  }

  function isCommentPostPath() {
    const p = location.pathname;
    if (/^\/r\/[^/]+\/comments\//i.test(p)) return true;
    /* Short post URLs: reddit.com/comments/{id}/… (no /r/name segment) */
    if (/^\/comments\/[^/]+/i.test(p)) return true;
    return false;
  }

  /**
   * Hide FAB + reader when leaving a post URL (SPA); invalidate in-flight `main()`.
   */
  function teardownRediumUi() {
    mainGeneration += 1;
    document.body.classList.remove("redium-reader-on");
    stopReaderEffects();
    readerState.treeEl = null;
    readerState.commentsMount = null;
    const rootEl = document.getElementById("redium-root");
    if (rootEl) rootEl.remove();
    lastBuiltPostPath = "";
    const toggleEl = document.getElementById("redium-toggle");
    if (toggleEl) toggleEl.remove();
  }

  /**
   * FAB + reader only on `/r/.../comments/...` post pages.
   */
  function syncRediumForCurrentPath() {
    if (!isExtensionRuntimeAlive()) {
      return;
    }
    try {
      if (!isCommentPostPath()) {
        teardownRediumUi();
        return;
      }

      ensureToggle();

      if (!readPreference()) {
        document.body.classList.remove("redium-reader-on");
        return;
      }

      document.body.classList.add("redium-reader-on");
      const cur = getCanonicalCommentPath();
      const rootEl = document.getElementById("redium-root");
      if (!rootEl || cur !== lastBuiltPostPath) {
        main();
      }
    } finally {
      syncToolbarIcon();
    }
  }

  function readPreference() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === null) return true;
      return v === "1";
    } catch (e) {
      return true;
    }
  }

  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v && THEME_IDS.indexOf(v) !== -1) return v;
    } catch (e) {
      /* ignore */
    }
    return "white";
  }

  /**
   * @param {EventTarget | null} target
   */
  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[contenteditable="true"]')) return true;
    if (target.closest("textarea")) return true;
    if (target.closest("select")) return true;
    const input = target.closest("input");
    if (input) {
      const t = (input.type || "").toLowerCase();
      if (
        t === "checkbox" ||
        t === "radio" ||
        t === "button" ||
        t === "submit" ||
        t === "reset" ||
        t === "file" ||
        t === "range" ||
        t === "color"
      ) {
        return false;
      }
      return true;
    }
    return false;
  }

  function installReaderKeyboardShortcut() {
    if (readerKeyboardShortcutInstalled) return;
    readerKeyboardShortcutInstalled = true;
    document.addEventListener(
      "keydown",
      function (e) {
        if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        const k = e.key && e.key.toLowerCase();
        if (k !== "m") return;
        if (isTypingTarget(e.target)) return;
        const cb = document.querySelector("#redium-toggle .redium-toggle-input");
        if (!cb) return;
        e.preventDefault();
        e.stopPropagation();
        /** @type {HTMLInputElement} */ (cb).click();
      },
      true
    );
  }

  function installToggleOutsideClose() {
    if (toggleOutsideCloseInstalled) return;
    toggleOutsideCloseInstalled = true;
    document.addEventListener(
      "click",
      function (e) {
        const wrap = document.getElementById("redium-toggle");
        if (!wrap || !(e.target instanceof Node)) return;
        if (wrap.contains(e.target)) return;
        wrap.classList.remove("redium-toggle-expanded");
        const fabBtn = wrap.querySelector(".redium-toggle-fab");
        if (fabBtn) fabBtn.setAttribute("aria-expanded", "false");
      },
      true
    );
  }

  function syncThemeTabUi() {
    const wrap = document.getElementById("redium-toggle");
    if (!wrap) return;
    const current =
      document.documentElement.getAttribute("data-redium-theme") || "white";
    const tabs = wrap.querySelectorAll(".redium-theme-tab");
    for (let i = 0; i < tabs.length; i++) {
      const btn = tabs[i];
      const tid = btn.getAttribute("data-theme");
      const active = tid === current;
      btn.classList.toggle("redium-theme-tab-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  /**
   * @param {string} theme
   */
  function applyTheme(theme) {
    var t = theme;
    if (THEME_IDS.indexOf(t) === -1) t = "white";
    document.documentElement.setAttribute("data-redium-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (e) {
      /* ignore */
    }
    syncThemeTabUi();
  }

  function isReaderModeOn() {
    return !!(document.body && document.body.classList.contains("redium-reader-on"));
  }

  /** Let the service worker set the tab toolbar icon (default vs winking "disabled" art). */
  function syncToolbarIcon() {
    if (!isExtensionRuntimeAlive()) {
      return;
    }
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    const readerOn =
      isCommentPostPath() &&
      !!(document.body && document.body.classList.contains("redium-reader-on"));
    try {
      chrome.runtime.sendMessage({
        type: "redium-toolbar-icon",
        readerOn: readerOn,
      });
    } catch (e) {
      /* extension context invalidated */
    }
  }

  /** Tree MO + expand poll + debounce (full rebuild); score registry survives until structural sync. */
  function stopCommentTreeEffects() {
    if (readerState.obs) {
      readerState.obs.disconnect();
      readerState.obs = null;
    }
    if (readerState.expandId != null) {
      clearInterval(readerState.expandId);
      readerState.expandId = null;
    }
    if (readerState.debounceTimer != null) {
      clearTimeout(readerState.debounceTimer);
      readerState.debounceTimer = null;
    }
  }

  function stopReaderEffects() {
    stopCommentTreeEffects();
    if (readerState.postScoreMo) {
      readerState.postScoreMo.disconnect();
      readerState.postScoreMo = null;
    }
    clearCommentScoreRegistry();
  }

  function startReaderEffects() {
    stopCommentTreeEffects();
    const treeEl = readerState.treeEl;
    const commentsMount = readerState.commentsMount;
    if (!treeEl || !commentsMount) return;

    function syncComments() {
      clearCommentScoreRegistry();
      const next = extractCommentsFromTree(treeEl);
      const redditExpandGlyph = tryCloneRedditExpandGlyph(treeEl);
      commentsMount.replaceChildren();
      for (let i = 0; i < next.length; i++) {
        commentsMount.appendChild(
          renderCommentNode(next[i], 0, redditExpandGlyph)
        );
      }
    }

    function scheduleSync() {
      if (readerState.debounceTimer != null) {
        clearTimeout(readerState.debounceTimer);
      }
      readerState.debounceTimer = window.setTimeout(function () {
        readerState.debounceTimer = null;
        if (!isReaderModeOn()) return;
        syncComments();
      }, DEBOUNCE_MS);
    }

    readerState.obs = new MutationObserver(function (mutations) {
      var structural = false;
      var i;
      var m;
      for (i = 0; i < mutations.length; i++) {
        m = mutations[i];
        if (m.type === "childList") {
          structural = true;
          break;
        }
      }
      if (structural) {
        scheduleSync();
        return;
      }
      /** @type {Set<string>} */
      var seenKeys = new Set();
      for (i = 0; i < mutations.length; i++) {
        m = mutations[i];
        if (m.type !== "attributes" || m.attributeName !== "score") {
          continue;
        }
        var t = /** @type {Element} */ (m.target);
        var com =
          t.closest && t.closest("shreddit-comment")
            ? t.closest("shreddit-comment")
            : t.tagName && t.tagName.toLowerCase() === "shreddit-comment"
              ? t
              : null;
        if (!com) continue;
        var key = commentScoreKeyFromCommentEl(com);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        var ui = readerState.commentScoreUiByKey.get(key);
        if (ui) applyCommentScoreUi(ui, com);
      }
    });
    readerState.obs.observe(treeEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["score"],
    });

    readerState.expandId = window.setInterval(function () {
      if (!isReaderModeOn()) return;
      autoExpandMoreReplies(treeEl);
    }, EXPAND_INTERVAL_MS);

    autoExpandMoreReplies(treeEl);
  }

  function ensureToggle() {
    if (document.getElementById("redium-toggle")) return;

    const wrap = document.createElement("div");
    wrap.id = "redium-toggle";

    const panel = document.createElement("div");
    panel.id = "redium-toggle-menu";
    panel.className = "redium-toggle-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Redium reader and theme");

    const brand = document.createElement("div");
    brand.className = "redium-toggle-panel-brand";
    brand.textContent = "Redium";

    const readerSection = document.createElement("div");
    readerSection.className = "redium-toggle-reader-section";

    const readerBlock = document.createElement("div");
    readerBlock.className = "redium-toggle-reader-block";

    const label = document.createElement("label");
    label.className = "redium-toggle-label redium-toggle-reader-label";

    const span = document.createElement("span");
    span.className = "redium-toggle-text";
    span.textContent = "Reader";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "redium-toggle-input";
    input.setAttribute("aria-label", "Redium reader view (Ctrl+M)");

    const hint = document.createElement("span");
    hint.className = "redium-toggle-hint";
    hint.textContent = "Ctrl + M";

    label.appendChild(span);
    label.appendChild(input);
    readerBlock.appendChild(label);
    readerBlock.appendChild(hint);
    readerSection.appendChild(readerBlock);

    const themeSection = document.createElement("div");
    themeSection.className = "redium-toggle-theme-section";

    const themeLabelEl = document.createElement("div");
    themeLabelEl.className = "redium-theme-label";
    themeLabelEl.textContent = "Theme";

    const tabList = document.createElement("div");
    tabList.className = "redium-theme-tabs";
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Reader color theme");

    const tabLabels = { white: "White", sepia: "Sepia", black: "Black" };

    for (let ti = 0; ti < THEME_IDS.length; ti++) {
      const id = THEME_IDS[ti];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "redium-theme-tab";
      btn.setAttribute("data-theme", id);
      btn.setAttribute("role", "tab");
      btn.textContent = tabLabels[id] || id;
      btn.addEventListener("click", function () {
        applyTheme(id);
      });
      tabList.appendChild(btn);
    }

    themeSection.appendChild(themeLabelEl);
    themeSection.appendChild(tabList);

    panel.appendChild(brand);
    panel.appendChild(readerSection);
    panel.appendChild(themeSection);

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "redium-toggle-fab";
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "redium-toggle-menu");
    fab.setAttribute(
      "title",
      "Redium — hover for reader & theme, or Ctrl+M to toggle reader"
    );

    const iconPrimary = safeExtensionGetUrl("icons/redium-app-icon.png");
    const iconFallback = safeExtensionGetUrl("icons/icon-48.png");
    if (!iconPrimary && !iconFallback) {
      fab.classList.add("redium-toggle-fab-letter");
      fab.appendChild(document.createTextNode("R"));
    } else {
      const img = document.createElement("img");
      img.className = "redium-toggle-fab-img";
      img.alt = "";
      img.draggable = false;
      img.addEventListener("error", function onFabImgErr() {
        img.removeEventListener("error", onFabImgErr);
        if (iconFallback && img.src !== iconFallback) {
          img.src = iconFallback;
          return;
        }
        img.remove();
        fab.classList.add("redium-toggle-fab-letter");
        fab.appendChild(document.createTextNode("R"));
      });
      img.src = iconPrimary || iconFallback || "";
      fab.appendChild(img);
    }

    wrap.appendChild(panel);
    wrap.appendChild(fab);

    input.checked = readPreference();

    input.addEventListener("change", function () {
      const on = input.checked;
      try {
        localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      if (on) {
        document.body.classList.add("redium-reader-on");
        main();
      } else {
        document.body.classList.remove("redium-reader-on");
        stopReaderEffects();
        readerState.treeEl = null;
        readerState.commentsMount = null;
        const prev = document.getElementById("redium-root");
        if (prev) prev.remove();
        lastBuiltPostPath = "";
      }
      syncToolbarIcon();
    });

    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      wrap.classList.toggle("redium-toggle-expanded");
      fab.setAttribute(
        "aria-expanded",
        wrap.classList.contains("redium-toggle-expanded") ? "true" : "false"
      );
    });

    document.body.appendChild(wrap);
    applyTheme(readTheme());
    installReaderKeyboardShortcut();
    installToggleOutsideClose();
  }

  function getCanonicalCommentPath() {
    const p = location.pathname;
    let m = p.match(/^(\/r\/[^/]+\/comments\/[^/]+)/i);
    if (m) return m[1].toLowerCase();
    m = p.match(/^(\/comments\/[^/]+)/i);
    return m ? m[1].toLowerCase() : "";
  }

  function getExpectedPostIdFromLocation() {
    const m = location.pathname.match(/\/comments\/([a-z0-9]+)/i);
    return m ? m[1].toLowerCase() : "";
  }

  /**
   * @param {Element} el
   * @param {string} expectedId
   */
  function postElementMatchesExpectedId(el, expectedId) {
    if (!expectedId) return true;
    const id = expectedId.toLowerCase();
    const perm = (el.getAttribute("permalink") || "").toLowerCase();
    if (perm.indexOf("comments/" + id) !== -1) return true;
    const pid = (
      el.getAttribute("post-id") ||
      el.getAttribute("id") ||
      ""
    ).toLowerCase();
    if (pid.indexOf(id) !== -1) return true;
    const tl = el.querySelector('a[slot="title"]');
    if (tl) {
      const raw =
        tl.getAttribute("href") ||
        (typeof tl.href === "string" ? tl.href : "") ||
        "";
      if (raw.toLowerCase().indexOf("comments/" + id) !== -1) return true;
    }
    const html = el.outerHTML;
    if (
      html &&
      html.length < 600000 &&
      html.toLowerCase().indexOf("/comments/" + id) !== -1
    ) {
      return true;
    }
    return false;
  }

  function findMatchingMainPost(expectedId) {
    const groups = [
      document.querySelectorAll("main shreddit-post"),
      document.querySelectorAll("article shreddit-post"),
      document.querySelectorAll("shreddit-post"),
    ];
    for (let g = 0; g < groups.length; g++) {
      const nl = groups[g];
      for (let i = 0; i < nl.length; i++) {
        const el = nl[i];
        if (postElementMatchesExpectedId(el, expectedId)) return el;
      }
    }
    return null;
  }

  /**
   * Wait for the shreddit post that matches the URL `/comments/{id}/`, not the first generic node (sidebar / stale).
   * @param {number} gen
   * @param {number} [timeoutMs]
   * @returns {Promise<Element|null>}
   */
  function waitForMatchingMainPost(gen, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    const expectedId = getExpectedPostIdFromLocation();

    return new Promise(function (resolve) {
      function tick() {
        if (gen !== mainGeneration) {
          resolve(null);
          return;
        }
        const found = findMatchingMainPost(expectedId);
        if (found) {
          resolve(found);
          return;
        }
        if (Date.now() > deadline) {
          resolve(
            document.querySelector("main shreddit-post") ||
              document.querySelector("article shreddit-post") ||
              null
          );
          return;
        }
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  /**
   * @param {Element} postEl
   * @param {number} gen
   * @param {number} [timeoutMs]
   * @returns {Promise<Element|null>}
   */
  function waitForCommentTreeNearPost(postEl, gen, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);

    function locateTree() {
      if (postEl && postEl.closest) {
        const mainEl = postEl.closest("main");
        if (mainEl) {
          const t = mainEl.querySelector("shreddit-comment-tree");
          if (t) return t;
        }
        const articleEl = postEl.closest("article");
        if (articleEl) {
          const t2 = articleEl.querySelector("shreddit-comment-tree");
          if (t2) return t2;
        }
      }
      const mainDoc = document.querySelector("main");
      if (mainDoc) {
        const t3 = mainDoc.querySelector("shreddit-comment-tree");
        if (t3) return t3;
      }
      return document.querySelector("shreddit-comment-tree");
    }

    return new Promise(function (resolve) {
      function tick() {
        if (gen !== mainGeneration) {
          resolve(null);
          return;
        }
        const tree = locateTree();
        if (tree) {
          resolve(tree);
          return;
        }
        if (Date.now() > deadline) {
          resolve(locateTree());
          return;
        }
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  /**
   * Rebuild reader from the live page (new shreddit DOM). Invalidates in-flight work via `mainGeneration`.
   */
  function main() {
    if (!isExtensionRuntimeAlive()) {
      return;
    }
    mainGeneration += 1;
    const gen = mainGeneration;

    const existingRoot = document.getElementById("redium-root");
    if (existingRoot) existingRoot.remove();

    stopReaderEffects();
    readerState.treeEl = null;
    readerState.commentsMount = null;

    waitForMatchingMainPost(gen, 90000).then(function (postEl) {
      if (!isExtensionRuntimeAlive()) return;
      if (gen !== mainGeneration) return;
      if (!isReaderModeOn()) return;

      if (!postEl) {
        if (gen !== mainGeneration) return;
        if (!isReaderModeOn()) return;
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div id="redium-root"><div class="redium-inner"><p class="redium-muted">Redium: could not find post content.</p></div></div>'
        );
        lastBuiltPostPath = getCanonicalCommentPath();
        return;
      }

      const mainPost = postEl;
      const post = extractPost(mainPost);

      waitForCommentTreeNearPost(mainPost, gen, 90000).then(function (treeEl) {
        if (!isExtensionRuntimeAlive()) return;
        if (gen !== mainGeneration) return;
        if (!isReaderModeOn()) return;

        const root = document.createElement("div");
        root.id = "redium-root";
        root.appendChild(renderPost(post, mainPost));

        if (!treeEl) {
          readerState.treeEl = null;
          readerState.commentsMount = null;
          const empty = document.createElement("section");
          empty.className = "redium-inner";
          empty.innerHTML =
            '<p class="redium-muted">No comment tree found yet.</p>';
          root.appendChild(empty);
          document.body.appendChild(root);
          lastBuiltPostPath = getCanonicalCommentPath();
          return;
        }

        const commentsSection = renderCommentsSection(
          extractCommentsFromTree(treeEl),
          treeEl
        );
        root.appendChild(commentsSection);
        document.body.appendChild(root);

        const commentsMount = root.querySelector("#redium-comments-root");
        if (!commentsMount) return;

        readerState.treeEl = treeEl;
        readerState.commentsMount = commentsMount;

        lastBuiltPostPath = getCanonicalCommentPath();
        startReaderEffects();
      });
    });
  }

  let navigationHookInstalled = false;

  function installNavigationRebuild() {
    if (navigationHookInstalled) return;
    navigationHookInstalled = true;

    let navDebounce = /** @type {ReturnType<typeof setTimeout> | null} */ (
      null
    );

    function onLocationMaybeChanged() {
      clearTimeout(navDebounce);
      navDebounce = window.setTimeout(function () {
        navDebounce = null;
        syncRediumForCurrentPath();
      }, 150);
    }

    window.addEventListener("popstate", onLocationMaybeChanged);

    const h = history;
    const origPush = h.pushState.bind(h);
    const origReplace = h.replaceState.bind(h);
    h.pushState = function () {
      const ret = origPush.apply(h, arguments);
      onLocationMaybeChanged();
      return ret;
    };
    h.replaceState = function () {
      const ret = origReplace.apply(h, arguments);
      onLocationMaybeChanged();
      return ret;
    };
  }

  let postPathPollInstalled = false;

  function installPostPathPoll() {
    if (postPathPollInstalled) return;
    postPathPollInstalled = true;
    let lastPolledPath = location.pathname;
    window.setInterval(function () {
      if (!isExtensionRuntimeAlive()) {
        return;
      }
      if (location.pathname !== lastPolledPath) {
        lastPolledPath = location.pathname;
        syncRediumForCurrentPath();
      }
    }, 450);
  }

  function boot() {
    if (!isExtensionRuntimeAlive()) {
      return;
    }
    installNavigationRebuild();
    installPostPathPoll();
    syncRediumForCurrentPath();
  }

  function runWhenReady() {
    function go() {
      if (!document.body) {
        requestAnimationFrame(go);
        return;
      }
      boot();
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", go);
    } else {
      go();
    }
  }

  runWhenReady();
})();
