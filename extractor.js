// Tablosco — content script
// Extracts semantic surfaces from any page, sends to side panel on request.

(() => {
  "use strict";

  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const results = [];
    for (const s of scripts) {
      try { results.push(JSON.parse(s.textContent)); }
      catch (_) { /* malformed, skip */ }
    }
    return results;
  }

  function extractOpenGraph() {
    const og = {};
    for (const meta of document.querySelectorAll('meta[property^="og:"]')) {
      const key = meta.getAttribute("property").slice(3);
      og[key] = meta.getAttribute("content");
    }
    return Object.keys(og).length ? og : null;
  }

  function extractMeta() {
    const meta = {};
    for (const el of document.querySelectorAll("meta[name]")) {
      meta[el.getAttribute("name")] = el.getAttribute("content");
    }
    // twitter cards
    for (const el of document.querySelectorAll('meta[name^="twitter:"]')) {
      meta[el.getAttribute("name")] = el.getAttribute("content");
    }
    return Object.keys(meta).length ? meta : null;
  }

  function extractTables() {
    const tables = [];
    for (const table of document.querySelectorAll("table")) {
      const headers = [];
      for (const th of table.querySelectorAll("thead th, tr:first-child th")) {
        headers.push(th.textContent.trim());
      }
      const rows = [];
      const bodyRows = table.querySelectorAll("tbody tr, tr");
      for (const tr of bodyRows) {
        const cells = [];
        let isHeader = true;
        for (const td of tr.querySelectorAll("td, th")) {
          if (td.tagName === "TD") isHeader = false;
          cells.push(td.textContent.trim());
        }
        if (!isHeader || (isHeader && rows.length > 0)) {
          // skip pure header rows already captured
        }
        if (cells.length && !cells.every(c => headers.includes(c))) {
          rows.push(cells);
        }
      }
      if (rows.length > 0) {
        tables.push({ headers, rows, rowCount: rows.length });
      }
    }
    return tables;
  }

  function extractHeadings() {
    const headings = [];
    for (const h of document.querySelectorAll("h1, h2, h3, h4")) {
      headings.push({
        level: parseInt(h.tagName[1]),
        text: h.textContent.trim().slice(0, 200),
        id: h.id || null,
      });
    }
    return headings;
  }

  function extractLinks() {
    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href;
      if (seen.has(href) || href.startsWith("javascript:")) continue;
      seen.add(href);
      const text = a.textContent.trim().slice(0, 120);
      if (text) links.push({ text, href });
    }
    return links;
  }

  function extractForms() {
    const forms = [];
    for (const form of document.querySelectorAll("form")) {
      const fields = [];
      for (const input of form.querySelectorAll("input, select, textarea")) {
        fields.push({
          tag: input.tagName.toLowerCase(),
          type: input.type || null,
          name: input.name || null,
          id: input.id || null,
          placeholder: input.placeholder || null,
          required: input.required,
        });
      }
      forms.push({
        action: form.action || null,
        method: form.method || "get",
        fields,
      });
    }
    return forms;
  }

  function extractReadable() {
    // Lightweight readable extraction (no dependency).
    // Grab the largest text-dense block.
    const candidates = document.querySelectorAll("article, [role='main'], main, .post-content, .entry-content, .article-body");
    let best = null;
    let bestLen = 0;
    for (const el of candidates) {
      const len = el.textContent.length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
    if (!best && document.body) {
      // fallback: longest <p> cluster
      const paras = document.querySelectorAll("p");
      const text = Array.from(paras).map(p => p.textContent.trim()).filter(t => t.length > 40);
      return text.length ? text.join("\n\n").slice(0, 5000) : null;
    }
    return best ? best.textContent.trim().slice(0, 5000) : null;
  }

  function extractAll() {
    return {
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      jsonLd: extractJsonLd(),
      openGraph: extractOpenGraph(),
      meta: extractMeta(),
      tables: extractTables(),
      headings: extractHeadings(),
      links: extractLinks(),
      forms: extractForms(),
      readable: extractReadable(),
    };
  }

  // Respond to extraction requests from background/sidepanel
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "extract") {
      sendResponse(extractAll());
    }
    return true; // async
  });
})();
