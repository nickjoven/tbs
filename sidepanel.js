// Tablosco — side panel controller
// Principle: let data choose its shape. Trees for trees, tables for tables.
(() => {
  "use strict";

  let data = null;
  let currentView = "surfaces";
  let selectedIdx = -1;
  let selectables = [];        // flat list of selectable DOM nodes
  let treeNodes = new Map();   // id -> { el, childrenEl, expanded, depth }
  let sortState = {};          // tableIndex -> { col, asc }

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];
  const content = $("#content");
  const statusEl = $("#status");
  const filterEl = $("#filter");
  const helpEl = $("#help");
  const tabs = $$(".tab-btn");

  // ============================================================
  //  EXTRACTION
  // ============================================================

  async function extract() {
    statusEl.textContent = "extracting...";
    content.innerHTML = "";
    content.appendChild(statusEl);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { statusEl.textContent = "no active tab"; return; }

    chrome.tabs.sendMessage(tab.id, { type: "extract" }, (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = "reload page to inject extractor";
        return;
      }
      if (!response) { statusEl.textContent = "no data returned"; return; }
      data = response;
      updateBadges();
      render();
    });
  }

  function updateBadges() {
    if (!data) return;
    const counts = {
      surfaces: [data.jsonLd?.length, data.openGraph ? 1 : 0, data.headings?.length].reduce((a, b) => a + (b || 0), 0),
      tables: data.tables?.length || 0,
      links: data.links?.length || 0,
      forms: data.forms?.length || 0,
    };
    for (const t of tabs) {
      const v = t.dataset.view;
      const existing = t.querySelector(".badge");
      if (existing) existing.remove();
      if (counts[v]) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = counts[v];
        t.appendChild(b);
      }
    }
  }

  // ============================================================
  //  RENDERING DISPATCH
  // ============================================================

  function render() {
    if (!data) { content.innerHTML = '<div class="status">no data yet</div>'; return; }
    selectedIdx = -1;
    selectables = [];
    treeNodes = new Map();
    const q = filterEl.value.toLowerCase();

    content.innerHTML = "";
    switch (currentView) {
      case "surfaces": renderSurfaces(q); break;
      case "tables":   renderTables(q); break;
      case "links":    renderLinks(q); break;
      case "forms":    renderForms(q); break;
      case "raw":      renderRaw(q); break;
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  function esc(s) {
    if (s == null) return "";
    const d = document.createElement("span");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function matches(text, q) {
    return !q || (text && text.toLowerCase().includes(q));
  }

  function isUrl(s) {
    return typeof s === "string" && /^https?:\/\//.test(s);
  }

  function section(title, countOrLabel) {
    const sec = el("div", "section");
    const header = el("div", "section-title");
    header.innerHTML = `${esc(title)}`;
    if (countOrLabel != null) {
      header.innerHTML += `<span class="section-count">${esc(String(countOrLabel))}</span>`;
    }
    sec.appendChild(header);
    return sec;
  }

  // ============================================================
  //  TREE RENDERER — the core structural primitive
  // ============================================================

  let treeIdCounter = 0;

  function buildTree(value, key, depth, parentUl) {
    const id = `tn-${treeIdCounter++}`;

    if (value === null || value === undefined) {
      const li = el("li", "tree-node selectable");
      li.dataset.treeId = id;
      li.innerHTML = `<span class="tree-toggle"></span>`
        + (key != null ? `<span class="tree-key">${esc(key)}</span>: ` : "")
        + `<span class="tree-val null">null</span>`;
      parentUl.appendChild(li);
      treeNodes.set(id, { el: li, childrenEl: null, expanded: false, depth });
      selectables.push(li);
      return;
    }

    if (Array.isArray(value)) {
      // Array: collapsible node
      const li = el("li", "tree-node selectable");
      li.dataset.treeId = id;
      const startExpanded = depth < 2;

      li.innerHTML = `<span class="tree-toggle">${startExpanded ? "▼" : "▶"}</span>`
        + (key != null ? `<span class="tree-key">${esc(key)}</span>: ` : "")
        + `<span class="tree-bracket">[</span>`
        + `<span class="tree-summary">${value.length} items</span>`
        + `<span class="tree-bracket collapse-bracket ${startExpanded ? "hidden" : ""}">]</span>`;

      const childUl = el("ul", `tree tree-children${startExpanded ? "" : " collapsed"}`);
      value.forEach((item, i) => buildTree(item, i, depth + 1, childUl));

      // Closing bracket as its own node
      const closeLi = el("li", "tree-node");
      closeLi.innerHTML = `<span class="tree-bracket">]</span>`;
      childUl.appendChild(closeLi);

      parentUl.appendChild(li);
      parentUl.appendChild(childUl);
      treeNodes.set(id, { el: li, childrenEl: childUl, expanded: startExpanded, depth });
      selectables.push(li);
      return;
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      const li = el("li", "tree-node selectable");
      li.dataset.treeId = id;
      const startExpanded = depth < 2;

      // Peek: show @type or type inline if present
      const typeHint = value["@type"] || value.type || "";
      const hint = typeHint ? ` ${esc(typeHint)}` : "";

      li.innerHTML = `<span class="tree-toggle">${startExpanded ? "▼" : "▶"}</span>`
        + (key != null ? `<span class="tree-key">${esc(key)}</span>: ` : "")
        + `<span class="tree-bracket">{</span>`
        + `<span class="tree-summary">${keys.length} keys${hint}</span>`
        + `<span class="tree-bracket collapse-bracket ${startExpanded ? "hidden" : ""}">}</span>`;

      const childUl = el("ul", `tree tree-children${startExpanded ? "" : " collapsed"}`);
      for (const k of keys) buildTree(value[k], k, depth + 1, childUl);

      const closeLi = el("li", "tree-node");
      closeLi.innerHTML = `<span class="tree-bracket">}</span>`;
      childUl.appendChild(closeLi);

      parentUl.appendChild(li);
      parentUl.appendChild(childUl);
      treeNodes.set(id, { el: li, childrenEl: childUl, expanded: startExpanded, depth });
      selectables.push(li);
      return;
    }

    // Leaf: string, number, boolean
    const li = el("li", "tree-node selectable");
    li.dataset.treeId = id;
    let valClass = "str";
    let display = esc(String(value));
    if (typeof value === "number") valClass = "num";
    else if (typeof value === "boolean") valClass = "bool";
    else if (isUrl(value)) {
      valClass = "url";
      display = `<a href="${esc(value)}" target="_blank">${esc(value)}</a>`;
    }

    li.innerHTML = `<span class="tree-toggle"></span>`
      + (key != null ? `<span class="tree-key">${esc(key)}</span>: ` : "")
      + `<span class="tree-val ${valClass}">${display}</span>`;

    parentUl.appendChild(li);
    treeNodes.set(id, { el: li, childrenEl: null, expanded: false, depth });
    selectables.push(li);
  }

  function toggleTreeNode(id, forceState) {
    const node = treeNodes.get(id);
    if (!node || !node.childrenEl) return;

    const newState = forceState !== undefined ? forceState : !node.expanded;
    if (newState === node.expanded) return;

    node.expanded = newState;
    node.childrenEl.classList.toggle("collapsed", !newState);
    const toggle = node.el.querySelector(".tree-toggle");
    if (toggle) toggle.textContent = newState ? "▼" : "▶";
    const cb = node.el.querySelector(".collapse-bracket");
    if (cb) cb.classList.toggle("hidden", newState);
  }

  function toggleAll(expand) {
    for (const [id, node] of treeNodes) {
      if (node.childrenEl) toggleTreeNode(id, expand);
    }
  }

  // ============================================================
  //  SURFACES VIEW — smart structure selection
  // ============================================================

  function renderSurfaces(q) {
    // Page identity (always flat k/v)
    const pageSec = section("page");
    const kvs = [
      ["title", data.title],
      ["url", data.url],
      ["extracted", data.timestamp],
    ];
    for (const [k, v] of kvs) {
      if (matches(k + v, q)) {
        const row = el("div", "kv");
        row.innerHTML = `<span class="kv-key">${esc(k)}</span><span class="kv-val">${
          isUrl(v) ? `<a href="${esc(v)}" target="_blank">${esc(v)}</a>` : esc(v)
        }</span>`;
        pageSec.appendChild(row);
      }
    }
    content.appendChild(pageSec);

    // OpenGraph — flat k/v (it's always flat)
    if (data.openGraph) {
      const ogSec = section("open graph", Object.keys(data.openGraph).length);
      for (const [k, v] of Object.entries(data.openGraph)) {
        if (matches(k + v, q)) {
          const row = el("div", "kv");
          row.innerHTML = `<span class="kv-key">${esc(k)}</span><span class="kv-val">${
            isUrl(v) ? `<a href="${esc(v)}" target="_blank">${esc(v)}</a>` : esc(v)
          }</span>`;
          ogSec.appendChild(row);
        }
      }
      if (ogSec.children.length > 1) content.appendChild(ogSec);
    }

    // Meta — flat k/v
    if (data.meta) {
      const metaSec = section("meta", Object.keys(data.meta).length);
      for (const [k, v] of Object.entries(data.meta)) {
        if (matches(k + v, q)) {
          const row = el("div", "kv");
          row.innerHTML = `<span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(v)}</span>`;
          metaSec.appendChild(row);
        }
      }
      if (metaSec.children.length > 1) content.appendChild(metaSec);
    }

    // JSON-LD — THIS IS THE BIG ONE. Tree, not flattened.
    if (data.jsonLd && data.jsonLd.length) {
      for (let i = 0; i < data.jsonLd.length; i++) {
        const obj = data.jsonLd[i];
        const typeLabel = obj["@type"] || obj.type || `object ${i + 1}`;
        const ldSec = section(`json-ld: ${typeLabel}`);
        const tree = el("ul", "tree");
        treeIdCounter = 0; // reset per section for cleaner ids
        buildTree(obj, null, 0, tree);
        ldSec.appendChild(tree);
        content.appendChild(ldSec);
      }
    }

    // Headings — tree (indented outline)
    if (data.headings && data.headings.length) {
      const filteredHeadings = q ? data.headings.filter(h => matches(h.text, q)) : data.headings;
      if (filteredHeadings.length) {
        const hSec = section("outline", filteredHeadings.length);
        const ol = el("ul", "outline");
        for (const h of filteredHeadings) {
          const li = el("li", "outline-node selectable");
          li.style.paddingLeft = `${(h.level - 1) * 14}px`;
          li.innerHTML = `<span class="outline-depth">h${h.level}</span>`
            + `<span class="outline-text">${esc(h.text)}</span>`
            + (h.id ? `<span class="outline-id">#${esc(h.id)}</span>` : "");
          ol.appendChild(li);
          selectables.push(li);
        }
        hSec.appendChild(ol);
        content.appendChild(hSec);
      }
    }

    // Readable — just text, truncated
    if (data.readable && matches(data.readable, q)) {
      const rSec = section("readable", `${(data.readable.length / 1000).toFixed(1)}k chars`);
      const pre = el("div", "readable", esc(data.readable.slice(0, 3000)));
      rSec.appendChild(pre);
      content.appendChild(rSec);
    }
  }

  // ============================================================
  //  TABLES VIEW — sortable, filterable
  // ============================================================

  function renderTables(q) {
    if (!data.tables || !data.tables.length) {
      content.appendChild(el("div", "empty", "no tables on page"));
      return;
    }

    data.tables.forEach((tbl, ti) => {
      const sec = section(`table ${ti + 1}`, `${tbl.rowCount} rows`);

      // Determine headers
      const headers = tbl.headers.length ? tbl.headers : tbl.rows[0]?.map((_, i) => `col ${i}`) || [];

      // Filter rows
      let rows = tbl.rows;
      if (q) rows = rows.filter(r => r.some(c => matches(c, q)));

      // Sort
      const ss = sortState[ti];
      if (ss != null) {
        rows = [...rows].sort((a, b) => {
          const av = a[ss.col] || "", bv = b[ss.col] || "";
          // Try numeric
          const an = parseFloat(av), bn = parseFloat(bv);
          if (!isNaN(an) && !isNaN(bn)) return ss.asc ? an - bn : bn - an;
          return ss.asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }

      const table = document.createElement("table");
      table.className = "data";

      // Thead
      const thead = document.createElement("thead");
      const hrow = document.createElement("tr");
      headers.forEach((h, ci) => {
        const th = document.createElement("th");
        th.textContent = h;
        if (ss && ss.col === ci) {
          th.innerHTML += `<span class="sort-arrow">${ss.asc ? "▲" : "▼"}</span>`;
        }
        th.addEventListener("click", () => {
          if (sortState[ti]?.col === ci) {
            sortState[ti].asc = !sortState[ti].asc;
          } else {
            sortState[ti] = { col: ci, asc: true };
          }
          render();
        });
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);

      // Tbody
      const tbody = document.createElement("tbody");
      rows.forEach((row, ri) => {
        const tr = document.createElement("tr");
        tr.classList.add("selectable");
        tr.dataset.selectable = `${ti}-${ri}`;
        row.forEach(cell => {
          const td = document.createElement("td");
          td.textContent = cell;
          td.title = cell; // full text on hover
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
        selectables.push(tr);
      });
      table.appendChild(tbody);

      sec.appendChild(table);
      content.appendChild(sec);
    });
  }

  // ============================================================
  //  LINKS VIEW — grouped by domain, collapsible
  // ============================================================

  function renderLinks(q) {
    if (!data.links || !data.links.length) {
      content.appendChild(el("div", "empty", "no links on page"));
      return;
    }

    // Group by domain
    const groups = new Map();
    const pageHost = new URL(data.url).hostname;

    for (const link of data.links) {
      if (q && !matches(link.text + link.href, q)) continue;
      let host;
      try { host = new URL(link.href).hostname; } catch { host = "other"; }
      if (!groups.has(host)) groups.set(host, []);
      groups.get(host).push(link);
    }

    // Sort: same-domain first, then by count descending
    const sorted = [...groups.entries()].sort((a, b) => {
      if (a[0] === pageHost) return -1;
      if (b[0] === pageHost) return 1;
      return b[1].length - a[1].length;
    });

    const sec = section("links", data.links.length);

    for (const [host, links] of sorted) {
      const group = el("div", "link-group");
      const isSameDomain = host === pageHost;

      const header = el("div", "link-group-header");
      header.innerHTML = `<span class="tree-toggle">▼</span>`
        + `${esc(host)}`
        + `<span class="section-count">${links.length}</span>`
        + (isSameDomain ? `<span class="pill">self</span>` : "");

      const body = el("div", "");
      for (const link of links) {
        const row = el("div", "link-row selectable");
        row.dataset.href = link.href;
        try {
          const path = new URL(link.href).pathname;
          row.innerHTML = `<a href="${esc(link.href)}" target="_blank">${esc(link.text)}</a>`
            + `<span class="link-path">${esc(path)}</span>`;
        } catch {
          row.innerHTML = `<a href="${esc(link.href)}" target="_blank">${esc(link.text)}</a>`;
        }
        body.appendChild(row);
        selectables.push(row);
      }

      header.addEventListener("click", () => {
        body.classList.toggle("hidden");
        const t = header.querySelector(".tree-toggle");
        t.textContent = body.classList.contains("hidden") ? "▶" : "▼";
      });

      group.appendChild(header);
      group.appendChild(body);
      sec.appendChild(group);
    }

    content.appendChild(sec);
  }

  // ============================================================
  //  FORMS VIEW — structured display
  // ============================================================

  function renderForms(q) {
    if (!data.forms || !data.forms.length) {
      content.appendChild(el("div", "empty", "no forms on page"));
      return;
    }

    data.forms.forEach((form, fi) => {
      const sec = section(`form ${fi + 1}`, `${form.fields.length} fields`);
      const block = el("div", "form-block");

      // Method + action
      const header = el("div", "kv");
      header.innerHTML = `<span class="form-method">${esc(form.method.toUpperCase())}</span>`
        + `<span class="kv-val">${esc(form.action || "(no action)")}</span>`;
      block.appendChild(header);

      // Fields as mini tree
      for (const f of form.fields) {
        const desc = [f.name || f.id, f.placeholder].filter(Boolean).join(" — ");
        if (q && !matches(desc + f.type + f.tag, q)) continue;

        const row = el("div", "form-field selectable");
        row.innerHTML = `<span class="form-field-type">${esc(f.tag)}${f.type ? `[${esc(f.type)}]` : ""}</span>`
          + `<span class="form-field-name">${esc(f.name || f.id || "")}</span>`
          + (f.placeholder ? `<span class="kv-key">"${esc(f.placeholder)}"</span>` : "")
          + (f.required ? `<span class="form-field-req">*</span>` : "");
        block.appendChild(row);
        selectables.push(row);
      }

      sec.appendChild(block);
      content.appendChild(sec);
    });
  }

  // ============================================================
  //  RAW VIEW — filtered JSON tree
  // ============================================================

  function renderRaw(q) {
    const sec = section("raw extraction");
    if (q) {
      // Filtered: show as tree so structure is navigable
      const filtered = filterObj(data, q);
      if (!filtered) {
        sec.appendChild(el("div", "empty", "no matches"));
      } else {
        const tree = el("ul", "tree");
        treeIdCounter = 0;
        buildTree(filtered, null, 0, tree);
        sec.appendChild(tree);
      }
    } else {
      // Unfiltered: full tree
      const tree = el("ul", "tree");
      treeIdCounter = 0;
      buildTree(data, null, 0, tree);
      sec.appendChild(tree);
    }
    content.appendChild(sec);
  }

  function filterObj(obj, q) {
    if (typeof obj === "string") return obj.toLowerCase().includes(q) ? obj : undefined;
    if (typeof obj === "number" || typeof obj === "boolean")
      return String(obj).toLowerCase().includes(q) ? obj : undefined;
    if (obj === null || obj === undefined) return undefined;
    if (Array.isArray(obj)) {
      const r = obj.map(x => filterObj(x, q)).filter(x => x !== undefined);
      return r.length ? r : undefined;
    }
    if (typeof obj === "object") {
      const r = {};
      let any = false;
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes(q)) { r[k] = v; any = true; continue; }
        const fv = filterObj(v, q);
        if (fv !== undefined) { r[k] = fv; any = true; }
      }
      return any ? r : undefined;
    }
    return undefined;
  }

  // ============================================================
  //  VIEW SWITCHING
  // ============================================================

  function switchView(view) {
    currentView = view;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.view === view));
    sortState = {};
    render();
  }

  tabs.forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

  // ============================================================
  //  KEYBOARD NAVIGATION
  // ============================================================

  function select(idx) {
    if (selectedIdx >= 0 && selectedIdx < selectables.length) {
      selectables[selectedIdx].classList.remove("selected");
    }
    selectedIdx = Math.max(0, Math.min(selectables.length - 1, idx));
    if (selectables[selectedIdx]) {
      selectables[selectedIdx].classList.add("selected");
      selectables[selectedIdx].scrollIntoView({ block: "nearest" });
    }
  }

  function selectedTreeId() {
    if (selectedIdx < 0 || !selectables[selectedIdx]) return null;
    return selectables[selectedIdx].dataset.treeId || null;
  }

  function copySelected() {
    if (selectedIdx < 0 || !selectables[selectedIdx]) return;
    const text = selectables[selectedIdx].textContent.trim();
    navigator.clipboard.writeText(text);
    flashStatus("copied");
  }

  function copySectionJson() {
    // Copy the nearest section's data as JSON
    if (!data) return;
    const sectionData = currentView === "raw" ? data : (data[currentView] || data);
    navigator.clipboard.writeText(JSON.stringify(sectionData, null, 2));
    flashStatus("section copied as JSON");
  }

  function openSelected() {
    if (selectedIdx < 0 || !selectables[selectedIdx]) return;
    const href = selectables[selectedIdx].dataset.href;
    if (href) { window.open(href, "_blank"); return; }
    const a = selectables[selectedIdx].querySelector("a[href]");
    if (a) window.open(a.href, "_blank");
  }

  function flashStatus(msg) {
    const s = el("div", "status", esc(msg));
    content.prepend(s);
    setTimeout(() => s.remove(), 1200);
  }

  document.addEventListener("keydown", (e) => {
    const inFilter = document.activeElement === filterEl;

    if (e.key === "Escape") {
      if (helpEl.classList.contains("visible")) { helpEl.classList.remove("visible"); return; }
      if (inFilter) { filterEl.value = ""; filterEl.blur(); render(); return; }
      return;
    }
    if (e.key === "?" && !inFilter) { helpEl.classList.toggle("visible"); return; }
    if (inFilter) return; // let filter handle its own input

    const viewKeys = { "1": "surfaces", "2": "tables", "3": "links", "4": "forms", "5": "raw" };
    if (viewKeys[e.key]) { switchView(viewKeys[e.key]); return; }

    switch (e.key) {
      case "/": e.preventDefault(); filterEl.focus(); break;
      case "j": select(selectedIdx + 1); break;
      case "k": select(selectedIdx - 1); break;
      case "l": {
        // Expand selected tree node
        const tid = selectedTreeId();
        if (tid) toggleTreeNode(tid, true);
        break;
      }
      case "h": {
        // Collapse selected tree node
        const tid = selectedTreeId();
        if (tid) {
          const node = treeNodes.get(tid);
          if (node && node.expanded) {
            toggleTreeNode(tid, false);
          } else if (node) {
            // If already collapsed, jump to parent
            // Find parent by walking selectables backward at lower depth
            for (let i = selectedIdx - 1; i >= 0; i--) {
              const pid = selectables[i].dataset.treeId;
              if (pid) {
                const pn = treeNodes.get(pid);
                if (pn && pn.depth < node.depth) { select(i); break; }
              }
            }
          }
        }
        break;
      }
      case "L": toggleAll(true); break;
      case "H": toggleAll(false); break;
      case "y": copySelected(); break;
      case "Y": copySectionJson(); break;
      case "Enter": openSelected(); break;
      case "r": extract(); break;
      case "g": select(0); break; // jump to top
      case "G": select(selectables.length - 1); break; // jump to bottom
    }
  });

  filterEl.addEventListener("input", () => render());

  // ============================================================
  //  MESSAGE HANDLING
  // ============================================================

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "trigger-extract") extract();
  });

  // Auto-extract on panel open
  extract();
})();
