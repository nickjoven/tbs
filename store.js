// Tablosco — content-addressed storage layer
// IndexedDB + SHA-256 hashing. Dedup by content hash.
(() => {
  "use strict";

  const DB_NAME = "tablosco";
  const DB_VERSION = 1;
  const STORE_EXTRACTIONS = "extractions"; // keyed by cid (sha-256 hex)
  const INDEX_URL = "by_url";
  const INDEX_TIME = "by_time";

  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_EXTRACTIONS)) {
          const store = d.createObjectStore(STORE_EXTRACTIONS, { keyPath: "cid" });
          store.createIndex(INDEX_URL, "url", { unique: false });
          store.createIndex(INDEX_TIME, "timestamp", { unique: false });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function sha256(content) {
    const encoded = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Store an extraction. Returns { cid, isNew, prevCid }.
  // prevCid is set if we have a prior extraction of the same URL.
  async function put(extraction) {
    const d = await open();
    const canonical = JSON.stringify(extraction, Object.keys(extraction).sort());
    const cid = await sha256(canonical);

    const record = {
      cid,
      url: extraction.url,
      title: extraction.title,
      timestamp: extraction.timestamp,
      data: extraction,
    };

    // Check for existing same-CID (dedup)
    const existing = await get(cid);
    if (existing) return { cid, isNew: false, prevCid: null };

    // Find previous extraction of same URL
    const prev = await latestByUrl(extraction.url);
    const prevCid = prev ? prev.cid : null;

    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readwrite");
      const store = tx.objectStore(STORE_EXTRACTIONS);
      store.put(record);
      tx.oncomplete = () => resolve({ cid, isNew: true, prevCid });
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  function get(cid) {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readonly");
      const req = tx.objectStore(STORE_EXTRACTIONS).get(cid);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    }));
  }

  function latestByUrl(url) {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readonly");
      const index = tx.objectStore(STORE_EXTRACTIONS).index(INDEX_URL);
      const req = index.getAll(url);
      req.onsuccess = () => {
        const results = req.result || [];
        if (!results.length) { resolve(null); return; }
        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        resolve(results[0]);
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  }

  function allByUrl(url) {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readonly");
      const index = tx.objectStore(STORE_EXTRACTIONS).index(INDEX_URL);
      const req = index.getAll(url);
      req.onsuccess = () => {
        const results = req.result || [];
        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        resolve(results);
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  }

  // Recent extractions, grouped by domain, sorted by time
  function recent(limit = 100) {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readonly");
      const index = tx.objectStore(STORE_EXTRACTIONS).index(INDEX_TIME);
      const results = [];
      const req = index.openCursor(null, "prev"); // newest first
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = (e) => reject(e.target.error);
    }));
  }

  function count() {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readonly");
      const req = tx.objectStore(STORE_EXTRACTIONS).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    }));
  }

  function remove(cid) {
    return open().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_EXTRACTIONS, "readwrite");
      tx.objectStore(STORE_EXTRACTIONS).delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    }));
  }

  // ============================================================
  //  DIFF — compute structural delta between two extractions
  // ============================================================

  function diff(older, newer) {
    if (!older || !newer) return null;
    const changes = [];

    // Compare flat fields
    for (const key of ["title", "url"]) {
      if (older[key] !== newer[key]) {
        changes.push({ type: "changed", path: key, old: older[key], new: newer[key] });
      }
    }

    // Compare headings
    const oldH = (older.headings || []).map(h => h.text);
    const newH = (newer.headings || []).map(h => h.text);
    const addedH = newH.filter(h => !oldH.includes(h));
    const removedH = oldH.filter(h => !newH.includes(h));
    if (addedH.length) changes.push({ type: "added", path: "headings", items: addedH });
    if (removedH.length) changes.push({ type: "removed", path: "headings", items: removedH });

    // Compare links count
    const oldL = older.links?.length || 0;
    const newL = newer.links?.length || 0;
    if (oldL !== newL) changes.push({ type: "changed", path: "links.count", old: oldL, new: newL });

    // Compare tables count + row counts
    const oldT = older.tables || [];
    const newT = newer.tables || [];
    if (oldT.length !== newT.length) {
      changes.push({ type: "changed", path: "tables.count", old: oldT.length, new: newT.length });
    } else {
      oldT.forEach((t, i) => {
        if (t.rowCount !== newT[i]?.rowCount) {
          changes.push({ type: "changed", path: `tables[${i}].rowCount`, old: t.rowCount, new: newT[i]?.rowCount });
        }
      });
    }

    // Compare meta keys
    const oldMK = Object.keys(older.meta || {}).sort();
    const newMK = Object.keys(newer.meta || {}).sort();
    const addedM = newMK.filter(k => !oldMK.includes(k));
    const removedM = oldMK.filter(k => !newMK.includes(k));
    if (addedM.length) changes.push({ type: "added", path: "meta", items: addedM });
    if (removedM.length) changes.push({ type: "removed", path: "meta", items: removedM });

    // Compare meta values
    for (const k of newMK) {
      if (oldMK.includes(k) && older.meta[k] !== newer.meta[k]) {
        changes.push({ type: "changed", path: `meta.${k}`, old: older.meta[k], new: newer.meta[k] });
      }
    }

    // Compare JSON-LD count
    const oldJ = older.jsonLd?.length || 0;
    const newJ = newer.jsonLd?.length || 0;
    if (oldJ !== newJ) changes.push({ type: "changed", path: "jsonLd.count", old: oldJ, new: newJ });

    // Compare forms count
    const oldF = older.forms?.length || 0;
    const newF = newer.forms?.length || 0;
    if (oldF !== newF) changes.push({ type: "changed", path: "forms.count", old: oldF, new: newF });

    return { changes, hasChanges: changes.length > 0 };
  }

  // ============================================================
  //  EXPORT — structured formats for external consumption
  // ============================================================

  function toMarkdown(extraction) {
    const lines = [];
    lines.push(`# ${extraction.title}`);
    lines.push(`> ${extraction.url}`);
    lines.push(`> Extracted: ${extraction.timestamp}`);
    lines.push("");

    // OG
    if (extraction.openGraph) {
      lines.push("## Open Graph");
      for (const [k, v] of Object.entries(extraction.openGraph)) {
        lines.push(`- **${k}**: ${v}`);
      }
      lines.push("");
    }

    // Outline
    if (extraction.headings?.length) {
      lines.push("## Page Outline");
      for (const h of extraction.headings) {
        lines.push(`${"  ".repeat(h.level - 1)}- ${h.text}`);
      }
      lines.push("");
    }

    // Tables
    if (extraction.tables?.length) {
      extraction.tables.forEach((tbl, i) => {
        lines.push(`## Table ${i + 1}`);
        if (tbl.headers.length) {
          lines.push("| " + tbl.headers.join(" | ") + " |");
          lines.push("| " + tbl.headers.map(() => "---").join(" | ") + " |");
        }
        for (const row of tbl.rows.slice(0, 50)) {
          lines.push("| " + row.join(" | ") + " |");
        }
        if (tbl.rows.length > 50) lines.push(`_(${tbl.rows.length - 50} more rows)_`);
        lines.push("");
      });
    }

    // JSON-LD
    if (extraction.jsonLd?.length) {
      lines.push("## Structured Data (JSON-LD)");
      lines.push("```json");
      lines.push(JSON.stringify(extraction.jsonLd, null, 2));
      lines.push("```");
      lines.push("");
    }

    // Readable
    if (extraction.readable) {
      lines.push("## Content");
      lines.push(extraction.readable.slice(0, 3000));
      lines.push("");
    }

    return lines.join("\n");
  }

  function toJson(extraction) {
    return JSON.stringify(extraction, null, 2);
  }

  // Export module
  window.TabloscoStore = { put, get, latestByUrl, allByUrl, recent, count, remove, diff, toMarkdown, toJson, sha256 };
})();
