/* AeonSight Pro core
   - Fixes: PDF.js init, JSZip for ePub.js
   - Features: import EPUB/PDF, open, navigate, progress %, delete
   - Storage: metadata + files in localStorage (base64) for demo purposes
*/

const el = (id) => document.getElementById(id);

// State
let current = {
  type: null,           // 'epub' | 'pdf'
  key: null,            // library key
  epub: null,           // book instance
  rendition: null,      // epub rendition
  pdfDoc: null,         // PDFDocumentProxy
  pdfPage: 1,
  pdfTotal: 1,
  readerMode: true
};

const libraryKey = 'aeonsight.library.v1';

// Helpers
function readAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsArrayBuffer(file);
  });
}
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function saveLibrary(lib) {
  localStorage.setItem(libraryKey, JSON.stringify(lib));
}
function loadLibrary() {
  try {
    const raw = localStorage.getItem(libraryKey);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}
function setStatus(msg) { el('status').textContent = msg; }
function setProgress(pct) {
  const clamp = Math.max(0, Math.min(100, Math.round(pct)));
  el('progressBar').style.width = clamp + '%';
  el('progressText').textContent = clamp + '%';
}

// Library UI
function renderLibrary() {
  const list = el('library');
  list.innerHTML = '';
  const lib = loadLibrary();
  if (lib.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No items yet. Use “Import” to add EPUB/PDF.';
    list.appendChild(empty);
    return;
  }
  lib.forEach(item => {
    const row = document.createElement('div');
    row.className = 'lib-item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('strong');
    title.textContent = item.title || item.name;
    const info = document.createElement('small');
    info.textContent = `${item.type.toUpperCase()} • ${item.sizeLabel || ''}`;

    meta.appendChild(title);
    meta.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'row';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = 'Open';
    openBtn.onclick = () => openFromLibrary(item.key);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = '🗑';
    delBtn.title = 'Remove from library';
    delBtn.onclick = () => {
      const confirmDel = confirm(`Remove "${item.title || item.name}" from your library?`);
      if (!confirmDel) return;
      const lib2 = loadLibrary().filter(x => x.key !== item.key);
      saveLibrary(lib2);
      renderLibrary();
      // If this item is currently open, reset viewer
      if (current.key === item.key) resetViewer();
    };

    actions.appendChild(openBtn);
    actions.appendChild(delBtn);

    row.appendChild(meta);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

// Reset viewer area
function resetViewer() {
  // EPUB
  if (current.rendition) {
    current.rendition.destroy();
    current.rendition = null;
  }
  if (current.epub) {
    try { current.epub.destroy(); } catch(_) {}
    current.epub = null;
  }
  el('epubArea').style.display = 'none';
  el('epubArea').innerHTML = '';

  // PDF
  el('pdfCanvas').style.display = 'none';
  const ctx = el('pdfCanvas').getContext('2d');
  ctx && ctx.clearRect(0,0,el('pdfCanvas').width, el('pdfCanvas').height);

  current.type = null;
  current.key = null;
  setStatus('Ready.');
  setProgress(0);
}

// Import files
async function handleImport(files) {
  const lib = loadLibrary();
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    const type = ext === 'pdf' ? 'pdf' : (ext === 'epub' ? 'epub' : null);
    if (!type) { alert(`Unsupported file: ${file.name}`); continue; }

    const buf = await readAsArrayBuffer(file);
    const b64 = arrayBufferToBase64(buf);
    const sizeKB = Math.round(file.size / 1024);
    const item = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      title: file.name.replace(/\.(epub|pdf)$/i,''),
      type,
      sizeLabel: `${sizeKB.toLocaleString()} KB`,
      data: b64,
      progress: 0,
      meta: {}
    };
    lib.unshift(item);
  }
  saveLibrary(lib);
  renderLibrary();
  setStatus(`Imported ${files.length} file(s).`);
}

// Open from library
async function openFromLibrary(key) {
  const lib = loadLibrary();
  const item = lib.find(x => x.key === key);
  if (!item) return;

  resetViewer();
  current.key = key;

  const bytes = base64ToUint8Array(item.data).buffer;
  if (item.type === 'epub') {
    await openEPUB(bytes, item);
  } else if (item.type === 'pdf') {
    await openPDF(bytes, item);
  }
}

// EPUB
async function openEPUB(arrayBuffer, item) {
  try {
    setStatus('Opening EPUB…');
    el('epubArea').style.display = 'block';
    const book = ePub(arrayBuffer);
    current.epub = book;

    // create rendition
    current.rendition = book.renderTo('epubArea', {
      width: '100%', height: '70vh', spread: 'auto', flow: 'paginated'
    });

    // Add reader mode styling
    const applyReaderCSS = () => {
      if (!current.readerMode) return;
      current.rendition.themes.default({
        'body': { 'background': '#0f1116', 'color': '#e9eefc', 'line-height': '1.6' },
        'p': { 'font-size': '1.05rem' }
      });
    };

    current.rendition.display(item?.meta?.cfi || undefined).then(applyReaderCSS);

    // Locations for percentage
    try { await book.ready; await book.locations.generate(1200); } catch(_) {}
    const updatePct = (cfi) => {
      let pct = 0;
      try { pct = Math.round(book.locations.percentageFromCfi(cfi) * 100); } catch(_) {}
      setProgress(pct);
      // save progress
      const lib = loadLibrary();
      const i = lib.findIndex(x => x.key === current.key);
      if (i >= 0) {
        lib[i].progress = pct;
        lib[i].meta.cfi = cfi;
        saveLibrary(lib);
      }
    };

    current.rendition.on('relocated', (loc) => {
      updatePct(loc && loc.start && loc.start.cfi ? loc.start.cfi : null);
    });

    setStatus(`EPUB: ${item.title}`);
    current.type = 'epub';
  } catch (err) {
    console.error(err);
    setStatus('Failed to open EPUB.');
  }
}

// PDF
async function openPDF(arrayBuffer, item) {
  try {
    setStatus('Opening PDF…');
    el('pdfCanvas').style.display = 'block';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    current.pdfDoc = pdf;
    current.pdfTotal = pdf.numPages;
    current.pdfPage = Math.min(Math.max(1, item?.meta?.page || 1), current.pdfTotal);
    await renderPDFPage(current.pdfPage);
    current.type = 'pdf';
    setStatus(`PDF: ${item.title}`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to open PDF.');
  }
}
async function renderPDFPage(pageNum) {
  const page = await current.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = el('pdfCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Update progress + save
  const pct = Math.round((pageNum / current.pdfTotal) * 100);
  setProgress(pct);
  const lib = loadLibrary();
  const i = lib.findIndex(x => x.key === current.key);
  if (i >= 0) {
    lib[i].progress = pct;
    lib[i].meta.page = pageNum;
    saveLibrary(lib);
  }
}

// Controls
el('prev').addEventListener('click', async () => {
  if (current.type === 'epub' && current.rendition) {
    await current.rendition.prev();
  } else if (current.type === 'pdf' && current.pdfDoc) {
    if (current.pdfPage > 1) {
      current.pdfPage--;
      await renderPDFPage(current.pdfPage);
    }
  }
});
el('next').addEventListener('click', async () => {
  if (current.type === 'epub' && current.rendition) {
    await current.rendition.next();
  } else if (current.type === 'pdf' && current.pdfDoc) {
    if (current.pdfPage < current.pdfTotal) {
      current.pdfPage++;
      await renderPDFPage(current.pdfPage);
    }
  }
});

el('toggleMode').addEventListener('click', () => {
  current.readerMode = !current.readerMode;
  el('toggleMode').textContent = `Reader Mode: ${current.readerMode ? 'ON' : 'OFF'}`;
  if (current.type === 'epub' && current.rendition) {
    current.rendition.themes.default(current.readerMode ? {
      'body': { 'background': '#0f1116', 'color': '#e9eefc', 'line-height': '1.6' },
      'p': { 'font-size': '1.05rem' }
    } : {}); // reset
  }
});

// Sleep Guard (simple: warn after X minutes without navigation)
let sleepTimer = null;
el('sleepGuard').addEventListener('click', () => {
  const mins = prompt('Wake-up alert after how many minutes of inactivity?', '10');
  const n = parseInt(mins, 10);
  if (!n || n < 1) return;
  if (sleepTimer) clearTimeout(sleepTimer);
  const startWatcher = () => {
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      try { new AudioContext().resume(); } catch(_) {}
      alert('⏰ Wake up! Time to turn the page or take a break.');
    }, n * 60 * 1000);
  };
  // Reset timer on navigation events
  document.addEventListener('click', startWatcher, { passive: true });
  document.addEventListener('keydown', startWatcher, { passive: true });
  startWatcher();
  setStatus(`Sleep Guard armed: ${n} minute(s).`);
});

// Clear library
el('clearLibrary').addEventListener('click', () => {
  if (!confirm('This will remove ALL items from your library. Continue?')) return;
  saveLibrary([]);
  renderLibrary();
  resetViewer();
});

// File input
el('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  await handleImport(files);
  // open the first imported file automatically
  const lib = loadLibrary();
  if (lib[0]) openFromLibrary(lib[0].key);
  e.target.value = '';
});

// First render
renderLibrary();

// Auto-open demo if library is empty and a demo file is present in the page (optional):
(async () => {
  const lib = loadLibrary();
  if (lib.length === 0) {
    setStatus('Ready. Import EPUB or PDF using the button above.');
  }
})();
