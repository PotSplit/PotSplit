/* AeonSight Pro — PotSplit
   EPUB + PDF viewer with zoom, fit, FOV, reader mode, invisible ink, stats,
   sleep guard, library, and persistence. */

(() => {
  // ---------- DOM ----------
  const fileInput   = $id('file-input');
  const libEl       = $id('lib');
  const stage       = $id('stage');
  const pageEl      = $('.page');
  const contentEl   = $id('content');
  const pageLabel   = $id('page-label');

  const btnPrev     = $id('btn-prev');
  const btnNext     = $id('btn-next');
  const btnZoomIn   = $id('btn-zoom-in');
  const btnZoomOut  = $id('btn-zoom-out');
  const btnFitW     = $id('btn-fit-width');
  const btnFitP     = $id('btn-fit-page');
  const btnSleep    = $id('btn-sleep');
  const btnClear    = $id('btn-clear');

  const fovInput    = $id('fov');
  const sleepMin    = $id('sleep-min');
  const toggleReader= $id('toggle-reader');
  const toggleInk   = $id('toggle-ink');

  const statName    = $id('stat-name');
  const statStatus  = $id('stat-status');
  const statProg    = $id('stat-progress');
  const statWords   = $id('stat-words');
  const statTime    = $id('stat-time');
  const statZoom    = $id('stat-zoom');

  // ---------- State ----------
  const state = {
    docName: '—',
    type: 'none',     // 'pdf' | 'epub' | 'txt' | 'html'
    pdf: null,        // PDFDocumentProxy
    pdfPage: 1,
    pdfPages: 0,
    pdfScale: 1.0,

    epubBook: null,   // ePub.js Book
    epubRend: null,   // ePub.js Rendition
    epubFontPct: 100,
    epubLoc: null,

    readerMode: true,
    inkOn: false,
    fov: 1200,

    sessionStart: Date.now(),
    sleepTimer: null,
    sleepArmed: false,

    library: loadLibrary(), // [{id, name, type, dataUrl, addedAt}]
  };

  // ---------- Utils ----------
  function $(sel, root = document){ return root.querySelector(sel); }
  function $id(id){ return document.getElementById(id); }
  function fmtTime(ms){
    const s = Math.floor(ms/1000), m = Math.floor(s/60), sec = s%60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
  }
  function wordCountFromText(text){
    if (!text) return 0;
    return (text.trim().match(/\b[\p{L}\p{N}'-]+\b/gu) || []).length;
  }
  function saveLibrary(){ localStorage.setItem('aeon:lib', JSON.stringify(state.library)); }
  function loadLibrary(){ try{ return JSON.parse(localStorage.getItem('aeon:lib')||'[]'); }catch{ return []; } }
  function saveSettings(){
    localStorage.setItem('aeon:settings', JSON.stringify({
      readerMode: state.readerMode, inkOn: state.inkOn, fov: state.fov
    }));
  }
  (function restoreSettings(){
    try{
      const s = JSON.parse(localStorage.getItem('aeon:settings')||'{}');
      if (typeof s.readerMode === 'boolean') { state.readerMode = s.readerMode; toggleReader.checked = s.readerMode; document.body.classList.toggle('reader-mode', s.readerMode); }
      if (typeof s.inkOn === 'boolean') { state.inkOn = s.inkOn; toggleInk.checked = s.inkOn; pageEl.classList.toggle('ink-on', s.inkOn); }
      if (typeof s.fov === 'number') { state.fov = s.fov; fovInput.value = s.fov; stage.style.perspective = `${s.fov}px`; }
    }catch{}
  })();

  // ---------- Library UI ----------
  function renderLibrary(){
    libEl.innerHTML = '';
    if (!state.library.length){
      libEl.innerHTML = `<div class="item"><div class="meta"><div class="title">Your library is empty</div><div class="sub">Open files to add them here</div></div></div>`;
      return;
    }
    state.library.forEach(item => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="meta">
          <div class="title">${escapeHtml(item.name)}</div>
          <div class="sub">${item.type.toUpperCase()} • ${new Date(item.addedAt).toLocaleString()}</div>
        </div>
        <div class="row">
          <button class="btn small" data-id="${item.id}" data-act="open">Open</button>
          <button class="btn small" data-id="${item.id}" data-act="del">🗑</button>
        </div>`;
      libEl.appendChild(el);
    });
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  renderLibrary();

  libEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const item = state.library.find(x => x.id === id);
    if (!item) return;

    if (act === 'open'){
      await openFromLibrary(item);
    } else if (act === 'del'){
      state.library = state.library.filter(x => x.id !== id);
      saveLibrary(); renderLibrary();
    }
  });

  btnClear.addEventListener('click', () => {
    if (confirm('Clear your entire library?')) {
      state.library = []; saveLibrary(); renderLibrary();
    }
  });

  // ---------- File Opening ----------
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = pickType(file.name);
    const dataUrl = await fileToDataUrl(file);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    state.library.unshift({ id, name: file.name, type, dataUrl, addedAt: Date.now() });
    saveLibrary(); renderLibrary();
    await openBuffer(file.name, type, dataUrl);
    fileInput.value = '';
  });

  async function openFromLibrary(item){
    await openBuffer(item.name, item.type, item.dataUrl);
  }

  function pickType(name){
    const n = name.toLowerCase();
    if (n.endsWith('.pdf')) return 'pdf';
    if (n.endsWith('.epub')) return 'epub';
    if (n.endsWith('.txt')) return 'txt';
    if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
    return 'pdf';
  }

  function fileToDataUrl(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function openBuffer(name, type, dataUrl){
    resetSleepGuard();
    state.docName = name;
    statName.textContent = name;
    statStatus.textContent = 'Loading…';
    contentEl.innerHTML = '';

    if (state.epubRend){ state.epubRend.destroy(); state.epubRend = null; }
    if (state.epubBook){ try{ state.epubBook.destroy(); }catch{} state.epubBook = null; }

    if (type === 'pdf'){
      await openPDF(name, dataUrl);
    } else if (type === 'epub'){
      await openEPUB(name, dataUrl);
    } else if (type === 'txt' || type === 'html'){
      await openPlain(name, dataUrl, type);
    }
  }

  // ---------- PDF ----------
  async function openPDF(name, dataUrl){
    try{
      const pdfData = atob(dataUrl.split(',')[1]);
      const byteArray = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) byteArray[i] = pdfData.charCodeAt(i);

      state.pdf = await pdfjsLib.getDocument({ data: byteArray }).promise;
      state.type = 'pdf';
      state.pdfPage = 1;
      state.pdfPages = state.pdf.numPages;
      state.pdfScale = loadNum('aeon:pdfScale', 1.0);

      await renderPDFPage();
      statStatus.textContent = 'Ready';
    }catch(err){
      statStatus.textContent = 'Error opening PDF';
      console.error(err);
      contentEl.innerHTML = `<p>Failed to open PDF.</p>`;
    }
  }

  async function renderPDFPage(){
    const page = await state.pdf.getPage(state.pdfPage);
    const viewport = page.getViewport({ scale: state.pdfScale });

    contentEl.innerHTML = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    contentEl.appendChild(canvas);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Update progress + words
    pageLabel.textContent = `Page ${state.pdfPage} / ${state.pdfPages}`;
    const pct = Math.round(100 * state.pdfPage / state.pdfPages);
    statProg.textContent = `${pct}%`;

    try{
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(it => it.str).join(' ');
      statWords.textContent = wordCountFromText(pageText);
    }catch{
      statWords.textContent = '—';
    }

    saveNum('aeon:pdfScale', state.pdfScale);
    statZoom.textContent = `${Math.round(state.pdfScale*100)}%`;
  }

  // ---------- EPUB ----------
  async function openEPUB(name, dataUrl){
    try{
      // Ensure JSZip present
      if (!window.JSZip) {
        console.error('JSZip not found — EPUB disabled');
        statStatus.textContent = 'JSZip missing (EPUB disabled)';
        return;
      }
      state.epubBook = ePub(dataUrl); // 0.3 API
      state.type = 'epub';
      state.epubFontPct = loadNum('aeon:epubFont', 100);

      // Render into a custom area
      contentEl.innerHTML = '';
      const mount = document.createElement('div');
      mount.style.minHeight = '60vh';
      contentEl.appendChild(mount);

      state.epubRend = state.epubBook.renderTo(mount, {
        width: '100%', height: '80vh', spread: 'none', allowScriptedContent: true
      });

      // Theme for reader-mode defaults
      state.epubRend.themes.register('aeon', {
        'body': { 'color': '#eef2ff', 'background': '#0c0f14', 'line-height': '1.7' },
        'p': { 'margin': '0 0 1em 0', 'font-size': '1rem' }
      });
      state.epubRend.themes.select('aeon');
      state.epubRend.themes.fontSize(`${state.epubFontPct}%`);

      await state.epubRend.display();

      updateEPUBMeta();
      attachEPUBHandlers();
      statStatus.textContent = 'Ready';
    }catch(err){
      statStatus.textContent = 'Error opening EPUB';
      console.error(err);
      contentEl.innerHTML = `<p>Failed to open EPUB.</p>`;
    }
  }

  function attachEPUBHandlers(){
    state.epubRend.on('rendered', async () => {
      // Progress
      try{
        const loc = await state.epubRend.currentLocation();
        if (loc && state.epubBook && state.epubBook.navigation){
          const cfi = loc.start?.cfi || '';
          state.epubLoc = cfi;
          const pct = Math.round((loc.start.percentage||0)*100);
          statProg.textContent = `${pct}%`;
          pageLabel.textContent = `EPUB • ${pct}%`;
        }
      }catch{}

      // Word count of visible iframe
      const contents = state.epubRend.getContents();
      let words = 0;
      if (contents && contents.length){
        try{
          const doc = contents[0].document;
          const txt = doc?.body?.innerText || '';
          words = wordCountFromText(txt);
        }catch{}
      }
      statWords.textContent = String(words);
    });
  }

  async function updateEPUBMeta(){
    try{
      const meta = await state.epubBook.loaded.metadata;
      const title = meta.title || state.docName;
      statName.textContent = title;
    }catch{
      statName.textContent = state.docName;
    }
  }

  // ---------- Plain files ----------
  async function openPlain(name, dataUrl, type){
    try{
      const body = atob(dataUrl.split(',')[1]);
      state.type = type;
      contentEl.innerHTML = '';
      const pre = document.createElement(type==='html' ? 'div' : 'pre');
      pre.style.whiteSpace = type==='html' ? 'normal' : 'pre-wrap';
      pre.style.font = '16px/1.6 system-ui, sans-serif';
      pre.textContent = type==='html' ? stripHtml(body) : body;
      contentEl.appendChild(pre);
      statProg.textContent = '—';
      statWords.textContent = wordCountFromText(pre.innerText);
      statStatus.textContent = 'Ready';
      pageLabel.textContent = 'Text';
    }catch(e){
      statStatus.textContent = 'Error opening file';
      contentEl.innerHTML = `<p>Failed to open file.</p>`;
    }
  }
  function stripHtml(s){ const d = document.createElement('div'); d.innerHTML = s; return d.textContent||d.innerText||''; }

  // ---------- Zoom / Fit ----------
  btnZoomIn.onclick = () => {
    if (state.type === 'pdf'){ state.pdfScale = Math.min(3, state.pdfScale + 0.1); renderPDFPage(); }
    if (state.type === 'epub'){ state.epubFontPct = Math.min(220, state.epubFontPct + 10); state.epubRend.themes.fontSize(`${state.epubFontPct}%`); saveNum('aeon:epubFont', state.epubFontPct); statZoom.textContent = `${state.epubFontPct}%`; }
  };
  btnZoomOut.onclick = () => {
    if (state.type === 'pdf'){ state.pdfScale = Math.max(0.5, state.pdfScale - 0.1); renderPDFPage(); }
    if (state.type === 'epub'){ state.epubFontPct = Math.max(70, state.epubFontPct - 10); state.epubRend.themes.fontSize(`${state.epubFontPct}%`); saveNum('aeon:epubFont', state.epubFontPct); statZoom.textContent = `${state.epubFontPct}%`; }
  };
  btnFitW.onclick = () => {
    // Fit Width: PDF scale to page width; EPUB — font ~110%
    if (state.type === 'pdf'){
      fitPdfTo('width');
    } else if (state.type === 'epub'){
      state.epubFontPct = 110;
      state.epubRend.themes.fontSize(`${state.epubFontPct}%`);
      statZoom.textContent = `110%`;
      saveNum('aeon:epubFont', state.epubFontPct);
    }
  };
  btnFitP.onclick = () => {
    // Fit Page: PDF scale to stage height; EPUB — font ~100%
    if (state.type === 'pdf'){
      fitPdfTo('page');
    } else if (state.type === 'epub'){
      state.epubFontPct = 100;
      state.epubRend.themes.fontSize(`100%`);
      statZoom.textContent = `100%`;
      saveNum('aeon:epubFont', state.epubFontPct);
    }
  };

  function fitPdfTo(mode){
    const pageArea = contentEl.getBoundingClientRect();
    // re-render current page at scale that fits
    state.pdf.getPage(state.pdfPage).then(page => {
      const vw = page.getViewport({ scale: 1 });
      const scaleW = (pageArea.width - 20) / vw.width;
      const scaleH = (pageArea.height - 20) / vw.height;
      state.pdfScale = mode === 'width' ? Math.max(0.5, Math.min(3, scaleW)) : Math.max(0.5, Math.min(3, scaleH));
      renderPDFPage();
    });
  }

  // ---------- Navigation ----------
  btnPrev.onclick = async () => {
    if (state.type === 'pdf' && state.pdfPage > 1){ state.pdfPage--; renderPDFPage(); }
    else if (state.type === 'epub'){ await state.epubRend.prev(); }
  };
  btnNext.onclick = async () => {
    if (state.type === 'pdf' && state.pdfPage < state.pdfPages){ state.pdfPage++; renderPDFPage(); }
    else if (state.type === 'epub'){ await state.epubRend.next(); }
  };

  // ---------- Reader mode & Ink ----------
  toggleReader.onchange = () => {
    state.readerMode = toggleReader.checked;
    document.body.classList.toggle('reader-mode', state.readerMode);
    saveSettings();
  };
  toggleInk.onchange = () => {
    state.inkOn = toggleInk.checked;
    pageEl.classList.toggle('ink-on', state.inkOn);
    saveSettings();
  };

  // ---------- FOV ----------
  fovInput.oninput = () => {
    state.fov = Number(fovInput.value);
    stage.style.perspective = `${state.fov}px`;
    saveSettings();
  };

  // ---------- Sleep Guard ----------
  let lastActivity = Date.now();
  ['click','wheel','keydown','pointermove','touchstart','scroll'].forEach(evt => {
    document.addEventListener(evt, () => lastActivity = Date.now(), {passive:true});
  });

  btnSleep.onclick = () => {
    if (state.sleepArmed){ resetSleepGuard(); return; }
    const mins = Math.max(1, Math.min(120, Number(sleepMin.value)||10));
    const interval = mins * 60 * 1000;
    state.sleepArmed = true;
    btnSleep.textContent = 'Stop';
    state.sleepTimer = setInterval(() => {
      if (Date.now() - lastActivity >= interval){ beep(); alert('⏰ Wake up! Time on page exceeded.'); lastActivity = Date.now(); }
    }, 2000);
  };
  function resetSleepGuard(){
    if (state.sleepTimer){ clearInterval(state.sleepTimer); state.sleepTimer = null; }
    state.sleepArmed = false; btnSleep.textContent = 'Start';
  }
  function beep(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.value=.06;
      o.start(); setTimeout(()=>{o.stop(); ctx.close()}, 350);
    }catch{}
  }

  // ---------- Session timer ----------
  setInterval(() => {
    statTime.textContent = fmtTime(Date.now() - state.sessionStart);
  }, 1000);

  // ---------- Helpers ----------
  function loadNum(key, def){ const v = Number(localStorage.getItem(key)); return isFinite(v)&&v>0 ? v : def; }
  function saveNum(key, v){ localStorage.setItem(key, String(v)); }

  // ---------- Init ----------
  statZoom.textContent = '100%';
})();
