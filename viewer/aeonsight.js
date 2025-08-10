// AeonSight Viewer — no servers, all client-side.
(() => {
  const els = {
    fileInput: document.getElementById('fileInput'),
    loadDemo: document.getElementById('loadDemo'),
    dropZone: document.getElementById('dropZone'),

    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    themeSelect: document.getElementById('themeSelect'),
    fontSelect: document.getElementById('fontSelect'),
    widthSelect: document.getElementById('widthSelect'),
    modeToggle: document.getElementById('modeToggle'),
    invisibleToggle: document.getElementById('invisibleToggle'),
    idleMinutes: document.getElementById('idleMinutes'),

    epubContainer: document.getElementById('epubContainer'),
    epubArea: document.getElementById('epubArea'),
    pdfContainer: document.getElementById('pdfContainer'),
    pdfCanvas: document.getElementById('pdfCanvas'),
    pdfPage: document.getElementById('pdfPage'),
    pdfTotal: document.getElementById('pdfTotal'),
    textContainer: document.getElementById('textContainer'),
    reader: document.getElementById('reader'),

    modeLabel: document.getElementById('modeLabel'),
    fileType: document.getElementById('fileType'),
    wordCount: document.getElementById('wordCount'),
    elapsed: document.getElementById('elapsed'),
    wpm: document.getElementById('wpm'),
    epubStat: document.getElementById('epubStat'),
    epubWhere: document.getElementById('epubWhere'),

    inkOverlay: document.getElementById('inkOverlay'),
  };

  // State
  let current = {
    type: 'text',     // 'epub' | 'pdf' | 'text'
    epub: null,       // ePub book instance
    rendition: null,  // ePub rendition
    pdf: null,        // pdf.js document
    pdfPageNum: 1,
    pdfScale: 1.1,
    startTime: Date.now(),
    lastWords: 0,
    idleTimer: null,
    idleMs: 10 * 60 * 1000, // default 10m
  };

  // Utility
  const secondsToHMS = s => {
    const hrs = Math.floor(s/3600).toString().padStart(2,'0');
    const mins = Math.floor((s%3600)/60).toString().padStart(2,'0');
    const sec = Math.floor(s%60).toString().padStart(2,'0');
    return `${hrs}:${mins}:${sec}`;
  };
  const countWords = text => (text.trim().match(/\b[\w’'-]+\b/g) || []).length;

  // Idle / sleep alert using WebAudio beep
  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.start(); setTimeout(()=>{osc.stop();ctx.close();}, 900);
    } catch {}
  };
  const resetIdle = () => {
    if (current.idleTimer) clearTimeout(current.idleTimer);
    if (current.idleMs > 0) {
      current.idleTimer = setTimeout(() => {
        beep();
        alert('⏰ Hey! You’ve been idle for a while. Need a quick break or page turn?');
      }, current.idleMs);
    }
  };
  ['click','keydown','pointermove','wheel','touchstart'].forEach(evt =>
    document.addEventListener(evt, resetIdle, {passive:true})
  );

  // Theme / font / width apply for text & epub
  function applyReadingPrefs() {
    // width
    els.reader.classList.remove('narrow','wide');
    els.reader.classList.add(els.widthSelect.value);

    // font
    els.reader.classList.remove('serif','mono');
    if (els.fontSelect.value === 'serif') els.reader.classList.add('serif');
    if (els.fontSelect.value === 'mono') els.reader.classList.add('mono');

    // theme (document-level)
    document.documentElement.classList.remove('theme-sepia','theme-light','theme-night');
    const t = els.themeSelect.value;
    if (t === 'sepia') document.documentElement.classList.add('theme-sepia');
    if (t === 'light') document.documentElement.classList.add('theme-light');
    if (t === 'night') document.documentElement.classList.add('theme-night');

    // epub rendition themes
    if (current.rendition) {
      const base = {
        'body': { 'background': 'transparent', 'color': '#eef2ff', 'line-height': '1.6' }
      };
      current.rendition.themes.register('as-dark', base);
      current.rendition.themes.select('as-dark');
      const fontSize = els.fontSelect.value === 'mono' ? '100%' :
                       els.fontSelect.value === 'serif' ? '113%' : '108%';
      current.rendition.themes.fontSize(fontSize);
    }
  }

  // Switch panels
  function showPanel(type) {
    current.type = type;
    els.fileType.textContent = type.toUpperCase();
    els.epubContainer.classList.toggle('hidden', type !== 'epub');
    els.pdfContainer.classList.toggle('hidden', type !== 'pdf');
    els.textContainer.classList.toggle('hidden', type !== 'text');
    els.epubStat.classList.toggle('hidden', type !== 'epub');
    resetIdle();
  }

  // Load text/html content
  function loadText(htmlOrText, isHTML=false) {
    showPanel('text');
    els.modeToggle.disabled = false; // Editor mode allowed
    els.reader.contentEditable = false;
    els.modeLabel.textContent = 'Reader';

    if (isHTML) els.reader.innerHTML = htmlOrText;
    else els.reader.textContent = htmlOrText;

    const words = countWords(els.reader.innerText);
    els.wordCount.textContent = words.toString();
  }

  // EPUB
  async function loadEpub(fileOrUrl) {
    if (current.rendition) { try { current.rendition.destroy(); } catch {} }
    if (current.epub) { try { current.epub.destroy(); } catch {} }
    current.epub = ePub(fileOrUrl);
    showPanel('epub');
    els.modeToggle.disabled = true; // no editor for epub
    els.modeLabel.textContent = 'Reader';
    current.rendition = current.epub.renderTo(els.epubArea, { width: '100%', height: '100%' });
    await current.rendition.display();

    // Track location/chapter
    current.rendition.on('relocated', (loc) => {
      const cfi = loc && loc.start ? loc.start.cfi : '';
      els.epubWhere.textContent = cfi ? `Location ${cfi.slice(0, 18)}…` : '—';
    });

    applyReadingPrefs();
  }

  // PDF
  async function loadPdf(file) {
    showPanel('pdf');
    els.modeToggle.disabled = true; // no editor for pdf
    els.modeLabel.textContent = 'Reader';
    current.pdfScale = 1.1;
    const data = file instanceof File ? await file.arrayBuffer() : file;
    current.pdf = await pdfjsLib.getDocument({ data }).promise;
    els.pdfTotal.textContent = current.pdf.numPages.toString();
    current.pdfPageNum = 1;
    await renderPdfPage();
  }
  async function renderPdfPage() {
    const page = await current.pdf.getPage(current.pdfPageNum);
    const viewport = page.getViewport({ scale: current.pdfScale });
    const canvas = els.pdfCanvas;
    const ctx = canvas.getContext('2d', { alpha:false });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    els.pdfPage.textContent = current.pdfPageNum.toString();
  }

  // Nav & Zoom
  els.prevBtn.onclick = async () => {
    if (current.type === 'epub' && current.rendition) current.rendition.prev();
    if (current.type === 'pdf' && current.pdf) {
      current.pdfPageNum = Math.max(1, current.pdfPageNum - 1);
      await renderPdfPage();
    }
    resetIdle();
  };
  els.nextBtn.onclick = async () => {
    if (current.type === 'epub' && current.rendition) current.rendition.next();
    if (current.type === 'pdf' && current.pdf) {
      current.pdfPageNum = Math.min(current.pdf.numPages, current.pdfPageNum + 1);
      await renderPdfPage();
    }
    resetIdle();
  };
  els.zoomIn.onclick = async () => {
    if (current.type === 'pdf') { current.pdfScale = Math.min(3, current.pdfScale + 0.1); await renderPdfPage(); }
    if (current.type === 'text') { els.reader.style.fontSize = (parseFloat(getComputedStyle(els.reader).fontSize) + 1) + 'px'; }
    if (current.type === 'epub' && current.rendition) current.rendition.themes.fontSize('+=5%');
  };
  els.zoomOut.onclick = async () => {
    if (current.type === 'pdf') { current.pdfScale = Math.max(0.5, current.pdfScale - 0.1); await renderPdfPage(); }
    if (current.type === 'text') { els.reader.style.fontSize = (parseFloat(getComputedStyle(els.reader).fontSize) - 1) + 'px'; }
    if (current.type === 'epub' && current.rendition) current.rendition.themes.fontSize('-=5%');
  };

  // Prefs
  els.themeSelect.onchange = applyReadingPrefs;
  els.fontSelect.onchange  = applyReadingPrefs;
  els.widthSelect.onchange = applyReadingPrefs;

  // Mode toggle (text/html only)
  els.modeToggle.onchange = () => {
    const edit = els.modeToggle.checked;
    if (current.type !== 'text') { els.modeToggle.checked = false; return; }
    els.reader.contentEditable = edit;
    els.modeLabel.textContent = edit ? 'Editor' : 'Reader';
  };

  // Invisible ink toggle
  els.invisibleToggle.onchange = () =>
    els.inkOverlay.classList.toggle('hidden', !els.invisibleToggle.checked);

  // Idle minutes
  els.idleMinutes.onchange = () => {
    const mins = parseInt(els.idleMinutes.value || '0', 10);
    current.idleMs = mins > 0 ? mins*60000 : 0;
    resetIdle();
  };

  // File handling
  els.fileInput.onchange = async (e) => {
    const f = e.target.files?.[0];
    if (f) await openFile(f);
    e.target.value = '';
  };

  // Drag & drop
  ['dragenter','dragover'].forEach(evt =>
    els.dropZone.addEventListener(evt, (e)=>{e.preventDefault(); e.stopPropagation(); els.dropZone.classList.add('drag');}, false)
  );
  ;['dragleave','drop'].forEach(evt =>
    els.dropZone.addEventListener(evt, (e)=>{e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag');}, false)
  );
  els.dropZone.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) await openFile(f);
  });

  // Demo text
  els.loadDemo.onclick = () => {
    const demo = `
      <h1>The Invisible Page</h1>
      <p><em>Demo content:</em> This is a tiny built-in sample for AeonSight. 
      Try the theme, font, width and invisible-ink toggles. Zoom the text, switch to Editor Mode, and type notes.</p>
      <p>Drag an EPUB or PDF above to switch engines instantly — all offline, in your browser.</p>
    `;
    loadText(demo, true);
  };

  // Open file by extension
  async function openFile(file) {
    const name = file.name.toLowerCase();
    current.startTime = Date.now();
    if (name.endsWith('.epub')) {
      await loadEpub(file);
    } else if (name.endsWith('.pdf')) {
      await loadPdf(file);
    } else if (name.endsWith('.txt')) {
      const txt = await file.text();
      loadText(txt, false);
    } else if (name.endsWith('.html') || name.endsWith('.htm')) {
      const html = await file.text();
      loadText(html, true);
    } else {
      alert('Unsupported file type. Use EPUB, PDF, TXT, or HTML.');
      return;
    }
    updateWordStats();
  }

  // Stats loop
  function updateWordStats() {
    const now = Date.now();
    const secs = Math.max(1, (now - current.startTime)/1000);
    els.elapsed.textContent = secondsToHMS(secs);

    if (current.type === 'text') {
      const words = countWords(els.reader.innerText);
      els.wordCount.textContent = words.toString();
      els.wpm.textContent = Math.round((words / secs) * 60) || '—';
    } else {
      els.wordCount.textContent = '—';
      els.wpm.textContent = '—';
    }
    requestAnimationFrame(updateWordStats);
  }
  updateWordStats();

  // Defaults
  applyReadingPrefs();
  resetIdle();
})();
