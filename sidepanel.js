// Tablosco — side panel controller
(() => {
  "use strict";

  let data = null;
  let currentView = "surfaces";
  let selectedRow = -1;
  let selectableElements = [];
  const content = document.getElementById("content");
  const status = document.getElementById("status");
  const filter = document.getElementById("filter");
  const help = document.getElementById("help");
  const tabs = document.querySelectorAll(".tab-btn");

  // --- Extraction ---

  async function extract() {
    status.textContent = "extracting...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { status.textContent = "no active tab"; return; }

    chrome.tabs.sendMessage(tab.id, { type: "extract" }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = "inject content script first (reload page)";
        return;
      }
      if (!response) { status.textContent = "no data returned"; return; }
      data = response;
      render();
    });
  }

  // --- Rendering ---

  function render() {
    if (!data) { content.innerHTML = '<div class="status">no data yet</div>'; return; }
    selectedRow = -1;
    selectableElements = [];
    const q = filter.value.toLowerCase();

    switch (currentView) {
      case "surfaces": renderSurfaces(q); break;
      case "tables": renderTables(q); break;
      case "links": renderLinks(q); break;
      case "forms": renderForms(q); break;
      case "raw": renderRaw(q); break;
    }
  }

  function matches(text, q) {
    return !q || (text && text.toLowerCase().includes(q));
  }

  function esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderSurfaces(q) {
    let html = "";

    // Title + URL
    html += `<div class="section">
      <div class="section-title">page</div>
      <div class="kv"><span class="kv-key">title</span><span class="kv-val">${esc(data.title)}</span></div>
      <div class="kv"><span class="kv-key">url</span><span class="kv-val">${esc(data.url)}</span></div>
      <div class="kv"><span class="kv-key">extracted</span><span class="kv-val">${esc(data.timestamp)}</span></div>
    </div>`;

    // OpenGraph
    if (data.openGraph) {
      let ogHtml = "";
      for (const [k, v] of Object.entries(data.openGraph)) {
        if (matches(k + v, q)) ogHtml += `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(v)}</span></div>`;
      }
      if (ogHtml) html += `<div class="section"><div class="section-title">open graph</div>${ogHtml}</div>`;
    }

    // Meta
    if (data.meta) {
      let metaHtml = "";
      for (const [k, v] of Object.entries(data.meta)) {
        if (matches(k + v, q)) metaHtml += `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(v)}</span></div>`;
      }
      if (metaHtml) html += `<div class="section"><div class="section-title">meta</div>${metaHtml}</div>`;
    }

    // JSON-LD
    if (data.jsonLd && data.jsonLd.length) {
      html += `<div class="section"><div class="section-title">json-ld (${data.jsonLd.length})</div>`;
      for (const obj of data.jsonLd) {
        html += renderJsonLdFlat(obj, q);
      }
      html += `</div>`;
    }

    // Headings (outline)
    if (data.headings && data.headings.length) {
      let hHtml = "";
      for (const h of data.headings) {
        if (matches(h.text, q)) {
          hHtml += `<li class="h${h.level}">${esc(h.text)}</li>`;
        }
      }
      if (hHtml) html += `<div class="section"><div class="section-title">outline (${data.headings.length})</div><ul class="heading-list">${hHtml}</ul></div>`;
    }

    // Readable excerpt
    if (data.readable && matches(data.readable, q)) {
      const truncated = data.readable.slice(0, 1500);
      html += `<div class="section"><div class="section-title">readable</div><div class="readable">${esc(truncated)}</div></div>`;
    }

    // Stats
    html += `<div class="section"><div class="section-title">stats</div>`;
    html += `<div class="kv"><span class="kv-key">tables</span><span class="kv-val">${data.tables ? data.tables.length : 0}</span></div>`;
    html += `<div class="kv"><span class="kv-key">links</span><span class="kv-val">${data.links ? data.links.length : 0}</span></div>`;
    html += `<div class="kv"><span class="kv-key">forms</span><span class="kv-val">${data.forms ? data.forms.length : 0}</span></div>`;
    html += `</div>`;

    content.innerHTML = html;
  }

  function renderJsonLdFlat(obj, q) {
    let html = "";
    const flat = flattenObj(obj, "");
    for (const [k, v] of Object.entries(flat)) {
      const vs = String(v);
      if (matches(k + vs, q)) {
        html += `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(vs.slice(0, 300))}</span></div>`;
      }
    }
    return html;
  }

  function flattenObj(obj, prefix, depth = 0) {
    if (depth > 5) return { [prefix]: "[deep]" };
    const out = {};
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          Object.assign(out, flattenObj(item, `${prefix}[${i}]`, depth + 1));
        } else {
          out[`${prefix}[${i}]`] = item;
        }
      });
    } else if (typeof obj === "object" && obj !== null) {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "object" && v !== null) {
          Object.assign(out, flattenObj(v, key, depth + 1));
        } else {
          out[key] = v;
        }
      }
    } else {
      out[prefix] = obj;
    }
    return out;
  }

  function renderTables(q) {
    if (!data.tables || !data.tables.length) {
      content.innerHTML = '<div class="empty">no tables found</div>';
      return;
    }
    let html = "";
    data.tables.forEach((tbl, ti) => {
      html += `<div class="section"><div class="section-title">table ${ti + 1} (${tbl.rowCount} rows)</div>`;
      html += `<table class="data"><thead><tr>`;
      if (tbl.headers.length) {
        tbl.headers.forEach(h => { html += `<th>${esc(h)}</th>`; });
      } else {
        // infer column count from first row
        (tbl.rows[0] || []).forEach((_, i) => { html += `<th>${i}</th>`; });
      }
      html += `</tr></thead><tbody>`;
      tbl.rows.forEach((row, ri) => {
        const rowText = row.join(" ");
        if (!matches(rowText, q)) return;
        html += `<tr data-selectable="${ti}-${ri}">`;
        row.forEach(cell => { html += `<td>${esc(cell)}</td>`; });
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;
    });
    content.innerHTML = html;
    selectableElements = content.querySelectorAll("[data-selectable]");
  }

  function renderLinks(q) {
    if (!data.links || !data.links.length) {
      content.innerHTML = '<div class="empty">no links found</div>';
      return;
    }
    let html = `<div class="section"><div class="section-title">links (${data.links.length})</div>`;
    data.links.forEach((link, i) => {
      if (!matches(link.text + link.href, q)) return;
      html += `<div class="link-row" data-selectable="${i}" data-href="${esc(link.href)}">
        <a href="${esc(link.href)}" target="_blank">${esc(link.text)}</a>
        <span class="kv-key" style="font-size:10px; margin-left:4px">${esc(new URL(link.href, data.url).hostname)}</span>
      </div>`;
    });
    html += `</div>`;
    content.innerHTML = html;
    selectableElements = content.querySelectorAll("[data-selectable]");
  }

  function renderForms(q) {
    if (!data.forms || !data.forms.length) {
      content.innerHTML = '<div class="empty">no forms found</div>';
      return;
    }
    let html = "";
    data.forms.forEach((form, fi) => {
      html += `<div class="form-block"><div class="section-title">form ${fi + 1} — ${esc(form.method.toUpperCase())} ${esc(form.action || "(no action)")}</div>`;
      form.fields.forEach(f => {
        const desc = [f.tag, f.type, f.name, f.placeholder].filter(Boolean).join(" | ");
        if (matches(desc, q)) {
          html += `<div class="form-field">${esc(desc)}${f.required ? " *" : ""}</div>`;
        }
      });
      html += `</div>`;
    });
    content.innerHTML = html;
  }

  function renderRaw(q) {
    const filtered = q ? filterObj(data, q) : data;
    content.innerHTML = `<div class="json-raw">${esc(JSON.stringify(filtered, null, 2))}</div>`;
  }

  function filterObj(obj, q) {
    if (typeof obj === "string") return obj.toLowerCase().includes(q) ? obj : undefined;
    if (Array.isArray(obj)) {
      const r = obj.map(x => filterObj(x, q)).filter(x => x !== undefined);
      return r.length ? r : undefined;
    }
    if (typeof obj === "object" && obj !== null) {
      const r = {};
      let any = false;
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes(q)) { r[k] = v; any = true; continue; }
        const fv = filterObj(v, q);
        if (fv !== undefined) { r[k] = fv; any = true; }
      }
      return any ? r : undefined;
    }
    return String(obj).toLowerCase().includes(q) ? obj : undefined;
  }

  // --- View switching ---

  function switchView(view) {
    currentView = view;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.view === view));
    render();
  }

  tabs.forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

  // --- Keyboard navigation ---

  function updateSelection(delta) {
    if (!selectableElements.length) return;
    if (selectedRow >= 0 && selectedRow < selectableElements.length) {
      selectableElements[selectedRow].classList.remove("selected");
    }
    selectedRow = Math.max(0, Math.min(selectableElements.length - 1, selectedRow + delta));
    selectableElements[selectedRow].classList.add("selected");
    selectableElements[selectedRow].scrollIntoView({ block: "nearest" });
  }

  function copySelected() {
    if (selectedRow < 0 || !selectableElements[selectedRow]) return;
    const text = selectableElements[selectedRow].textContent.trim();
    navigator.clipboard.writeText(text);
  }

  function openSelected() {
    if (selectedRow < 0 || !selectableElements[selectedRow]) return;
    const href = selectableElements[selectedRow].dataset.href;
    if (href) window.open(href, "_blank");
    else {
      const a = selectableElements[selectedRow].querySelector("a");
      if (a) window.open(a.href, "_blank");
    }
  }

  document.addEventListener("keydown", (e) => {
    // Don't capture when filter is focused (except Esc)
    const inFilter = document.activeElement === filter;

    if (e.key === "Escape") {
      if (help.classList.contains("visible")) { help.classList.remove("visible"); return; }
      if (inFilter) { filter.value = ""; filter.blur(); render(); return; }
      return;
    }

    if (e.key === "?") {
      if (inFilter) return;
      help.classList.toggle("visible");
      return;
    }

    if (inFilter) {
      // Live filter on input
      if (e.key === "Enter") { filter.blur(); return; }
      return;
    }

    const viewKeys = { "1": "surfaces", "2": "tables", "3": "links", "4": "forms", "5": "raw" };
    if (viewKeys[e.key]) { switchView(viewKeys[e.key]); return; }

    switch (e.key) {
      case "/": e.preventDefault(); filter.focus(); break;
      case "j": updateSelection(1); break;
      case "k": updateSelection(-1); break;
      case "y": copySelected(); break;
      case "Enter": openSelected(); break;
      case "r": extract(); break;
    }
  });

  filter.addEventListener("input", () => render());

  // --- Message handling ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "trigger-extract") extract();
  });

  // Auto-extract on panel open
  extract();
})();
