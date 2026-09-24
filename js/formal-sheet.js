/* ============================================================
   Delinaisi Maker — formal-sheet.js
   Pembangun DOM + pengelola peta untuk preset "Kop Akademik".

   Tanggung jawab:
     - Membangun struktur lembar 2 kolom (dibuat sekali, lalu dipakai ulang)
     - Memindahkan peta utama ke dalam frame berbingkai saat preset aktif,
       dan mengembalikannya saat preset lain dipilih
     - Mengisi semua teks dari state `layout.kop` (murni input user)
     - Menggambar ulang graticule, skala batang, dan inset saat peta bergerak
     - Membangun legenda otomatis dari kategori fitur + warna kustom user
   ============================================================ */

'use strict';

const FormalSheet = (function () {

  let sheet = null;          // root .formal-sheet
  let mapHost = null;        // wadah peta utama di dalam frame
  let insetMap = null;       // instance Leaflet kedua
  let insetBox = null;       // rectangle cakupan peta utama
  let insetReady = false;
  let rafId = null;
  let built = false;
  let installed = false;     // peta utama sedang berada di dalam sheet

  const INSET_ATTRIB = 'Esri, Garmin, GEBCO, NOAA';

  /* -------------------- Utilitas DOM -------------------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clearText(node, value) {
    if (!node) return;
    const v = (value == null ? '' : String(value)).trim();
    node.textContent = v;
    node.style.display = v ? '' : 'none';
  }

  /* -------------------- Membangun kerangka lembar -------------------- */
  function build() {
    if (built) return sheet;

    sheet = el('div', 'formal-sheet');

    /* ---- Kolom kiri: peta ---- */
    const mapCol = el('div', 'fl-map-col');
    const frame = el('div', 'fl-map-frame');
    mapHost = el('div', 'fl-map-host');
    const grat = el('canvas', 'fl-graticule-canvas');
    grat.id = 'fl-graticule';
    frame.appendChild(mapHost);
    frame.appendChild(grat);
    mapCol.appendChild(frame);

    /* ---- Kolom kanan: panel informasi ---- */
    const panel = el('div', 'fl-panel');

    // 1. Kop instansi
    const bKop = el('div', 'fl-block fl-kop');
    const logo = el('div', 'fl-kop-logo');
    logo.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.5" ' +
      'stroke-linejoin="round" stroke-linecap="round">' +
      '<path d="M12 2 L20 6 v6 c0 5 -3.4 8.4 -8 10 -4.6 -1.6 -8 -5 -8 -10 V6 z"/>' +
      '<path d="M12 7 v8 M8.5 11 h7"/></svg>';
    const kopText = el('div', 'fl-kop-text');
    const kopStudy = el('div', 'fl-kop-study');
    kopStudy.id = 'fl-kop-study';
    const kopInst = el('div', 'fl-kop-inst');
    kopInst.id = 'fl-kop-inst';
    kopText.appendChild(kopStudy);
    kopText.appendChild(kopInst);
    bKop.appendChild(logo);
    bKop.appendChild(kopText);
    panel.appendChild(bKop);

    // 2. Judul kegiatan
    const act = el('div', 'fl-block fl-activity');
    act.id = 'fl-activity';
    panel.appendChild(act);

    // 3. Judul peta
    const title = el('div', 'fl-block fl-title');
    title.id = 'fl-title';
    panel.appendChild(title);

    // 4. Blok skala
    const bScale = el('div', 'fl-block');
    const scaleRow = el('div', 'fl-scale-row');
    const scaleLeft = el('div', 'fl-scale-left');
    const scaleLabel = el('div', 'fl-scale-label');
    scaleLabel.id = 'fl-scale-label';
    const scaleBarHost = el('div', 'fl-scalebar');
    scaleBarHost.id = 'fl-scalebar';
    scaleLeft.appendChild(scaleLabel);
    scaleLeft.appendChild(scaleBarHost);
    scaleRow.appendChild(scaleLeft);
    scaleRow.appendChild(FormalLayout.buildCompass());
    bScale.appendChild(scaleRow);
    panel.appendChild(bScale);

    // 5. Sistem referensi
    const bRef = el('div', 'fl-block');
    const ref = el('div', 'fl-ref');
    [['Proyeksi', 'projection'], ['Zona', 'zone'], ['Datum', 'datum']].forEach(pair => {
      const lab = el('div', 'fl-ref-label', pair[0] + ' :');
      const val = el('div', 'fl-ref-val');
      val.id = 'fl-ref-' + pair[1];
      ref.appendChild(lab);
      ref.appendChild(val);
    });
    bRef.appendChild(ref);
    panel.appendChild(bRef);

    // 6. Diagram lokasi (inset)
    const bInset = el('div', 'fl-block');
    const insetHead = el('div', 'fl-head', 'Diagram Lokasi:');
    const insetWrap = el('div', 'fl-inset-wrap');
    const insetDiv = el('div', 'fl-inset-map');
    insetDiv.id = 'fl-inset-map';
    const insetGrat = el('canvas', 'fl-inset-graticule');
    insetGrat.id = 'fl-inset-graticule';
    const insetAttr = el('div', 'fl-inset-attr', INSET_ATTRIB);
    insetWrap.appendChild(insetDiv);
    insetWrap.appendChild(insetGrat);
    insetWrap.appendChild(insetAttr);
    bInset.appendChild(insetHead);
    bInset.appendChild(insetWrap);
    panel.appendChild(bInset);

    // 7. Legenda (tumbuh mengisi ruang)
    const bLeg = el('div', 'fl-block fl-block--grow');
    const legHead = el('div', 'fl-head', 'Legenda:');
    const legBody = el('div', 'fl-legend');
    legBody.id = 'fl-legend';
    bLeg.appendChild(legHead);
    bLeg.appendChild(legBody);
    panel.appendChild(bLeg);

    // 8. Sumber data
    const bSrc = el('div', 'fl-block');
    const srcHead = el('div', 'fl-head', 'Sumber Data dan Riwayat Peta:');
    const srcBody = el('div', 'fl-source');
    srcBody.id = 'fl-source';
    bSrc.appendChild(srcHead);
    bSrc.appendChild(srcBody);
    panel.appendChild(bSrc);

    // 9. Blok pengesahan
    const bSign = el('div', 'fl-block fl-block--sign');
    const sign = el('div', 'fl-sign');
    sign.innerHTML =
      '<div class="fl-sign-know">Mengetahui,</div>' +
      '<div class="fl-sign-role" id="fl-sign-role"></div>' +
      '<div class="fl-sign-studio" id="fl-sign-studio"></div>' +
      '<div class="fl-sign-space"></div>' +
      '<div class="fl-sign-name" id="fl-sign-name"></div>';
    bSign.appendChild(sign);
    panel.appendChild(bSign);

    sheet.appendChild(mapCol);
    sheet.appendChild(panel);

    built = true;
    return sheet;
  }

  /* -------------------- Peta utama masuk/keluar lembar --------------- */
  function installMap() {
    if (!built) build();
    if (installed) return;
    const mapEl = document.getElementById('map');
    if (!mapEl || !mapHost) return;

    mapHost.appendChild(mapEl);
    mapEl.classList.add('fl-map-inside');
    installed = true;

    // Peta berubah ukuran -> gambar ulang.
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} refresh(); }, 60);
    requestAnimationFrame(() => { try { map.invalidateSize(); } catch (e) {} refresh(); });
  }

  function uninstallMap() {
    if (!installed) return;
    const mapEl = document.getElementById('map');
    const wrap = document.getElementById('map-wrap');
    if (mapEl && wrap) {
      mapEl.classList.remove('fl-map-inside');
      // Kembalikan sebagai anak pertama #map-wrap (sebelum elemen overlay).
      wrap.insertBefore(mapEl, wrap.firstChild);
    }
    installed = false;
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);
  }

  function ensureSheet() {
    const wrap = document.getElementById('map-wrap');
    if (!wrap) return null;
    if (!built) build();
    if (!sheet.parentNode) wrap.appendChild(sheet);
    return sheet;
  }

  /* -------------------- Mengisi teks dari state -------------------- */
  function fillText() {
    if (!built) return;
    const k = (layout && layout.kop) || {};

    clearText(document.getElementById('fl-kop-study'), k.programStudy);
    clearText(document.getElementById('fl-kop-inst'), k.institution);

    const year = (k.activityYear || '').trim();
    const act = [(k.activityTitle || '').trim(), year].filter(Boolean).join(' ');
    clearText(document.getElementById('fl-activity'), act);

    // Judul peta: fallback ke "Peta Delinasi" supaya blok tidak kosong.
    const title = (layout.title || '').trim() || 'Peta Delinasi';
    clearText(document.getElementById('fl-title'), title);

    clearText(document.getElementById('fl-ref-projection'), k.projection);
    clearText(document.getElementById('fl-ref-zone'), k.zone);
    clearText(document.getElementById('fl-ref-datum'), k.datum);

    clearText(document.getElementById('fl-source'), k.sourceData);

    clearText(document.getElementById('fl-sign-role'), k.supervisorTitle);
    clearText(document.getElementById('fl-sign-studio'), k.activityTitle);

    const name = (k.mapmakerName || '').trim();
    const deg = (k.mapmakerDegree || '').trim();
    const nameEl = document.getElementById('fl-sign-name');
    if (nameEl) {
      nameEl.innerHTML = '';
      nameEl.appendChild(document.createTextNode(name));
      if (deg) {
        const s = el('span', 'fl-sign-degree', ', ' + deg);
        nameEl.appendChild(s);
      }
      nameEl.style.display = name ? '' : 'none';
    }

    // Skala numerik
    const rf = FormalLayout.representativeFraction(map);
    const label = document.getElementById('fl-scale-label');
    if (label) {
      label.textContent = 'SKALA: 1:' + FormalLayout.fmtNumber(rf);
    }
  }

  /* -------------------- Skala batang -------------------- */
  function refreshScaleBar() {
    const host = document.getElementById('fl-scalebar');
    if (!host) return;
    const width = host.clientWidth || 200;
    host.innerHTML = '';
    host.appendChild(FormalLayout.buildScaleBar(map, width));
  }

  /* -------------------- Graticule -------------------- */
  function refreshGraticule() {
    const cvs = document.getElementById('fl-graticule');
    if (!cvs) return;
    const frame = cvs.parentNode;
    if (!frame) return;

    const w = frame.clientWidth || 0;
    const h = frame.clientHeight || 0;
    if (!w || !h) return;

    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';

    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!map) return;
    FormalLayout.drawGraticule(ctx, map, { x: w, y: h }, { margin: 0 });
  }

  /* -------------------- Inset map + bounding box -------------------- */
  function initInset() {
    if (insetReady) return;
    const div = document.getElementById('fl-inset-map');
    if (!div || typeof L === 'undefined') return;

    // Inset: zoom-out jauh (skala provinsi/nasional), basemap lebih sederhana.
    insetMap = L.map(div, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      crossOrigin: true
    }).addTo(insetMap);

    insetMap.setView([-2.5, 118], 5);
    insetBox = L.rectangle([[0, 0], [0, 0]], {
      color: '#e01b1b',
      weight: 1.8,
      fillColor: '#e01b1b',
      fillOpacity: 0.10,
      interactive: false
    }).addTo(insetMap);

    insetReady = true;
    syncInset();
    // Kanvas baru punya ukuran setelah layout selesai; gambar ulang setelahnya.
    requestAnimationFrame(refreshInsetGraticule);
    setTimeout(refreshInsetGraticule, 120);
  }

  // Sinkronkan inset dengan peta utama: kotak merah = getBounds() peta utama.
  function syncInset() {
    if (!insetReady || !insetMap || !insetBox || !map) return;
    try {
      const b = map.getBounds();
      insetBox.setBounds(b);

      // Area kajian selalu terlihat, tapi inset tetap lebih luas dari peta utama.
      const zoomOut = Math.max(2, Math.min(map.getZoom() - 4, 9));
      insetMap.setView(b.getCenter(), zoomOut, { animate: false });
      // Grid inset ikut berubah saat cakupan berubah.
      refreshInsetGraticule();
    } catch (e) { /* diabaikan */ }
  }

  /* -------------------- Graticule inset -------------------- */
  // Inset juga diberi grid koordinat (spesifikasi: "plus grid koordinat"),
  // dengan langkah lebih jarang dan label ringkas karena area lebih luas.
  function refreshInsetGraticule() {
    const cvs = document.getElementById('fl-inset-graticule');
    if (!cvs || !insetReady || !insetMap) return;

    const wrap = cvs.parentNode;
    if (!wrap) return;
    const w = wrap.clientWidth || 0;
    const h = wrap.clientHeight || 0;
    if (!w || !h) return;

    const dpr = window.devicePixelRatio || 1;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';

    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Grid inset dibuat lebih jarang dari peta utama, dan tanpa label tepi
    // supaya tidak berdesakan di kotak kecil.
    // Jaga agar grid inset tetap informatif: jangan lebih jarang dari 10
    // derajat, dan jangan lebih rapat dari 1 derajat.
    const step = Math.min(Math.max(FormalLayout.intervalFor(insetMap.getZoom()), 1), 10);
    FormalLayout.drawGraticule(ctx, insetMap, { x: w, y: h }, {
      step: step,
      fontSize: 8,
      showEdgeLabels: false,
      color: 'rgba(30,30,30,.35)'
    });
  }

  /* -------------------- Legenda otomatis -------------------- */
  // Dibangun dari kategori unik yang benar-benar dipakai fitur user.
  function buildLegend() {
    const host = document.getElementById('fl-legend');
    if (!host) return;
    host.innerHTML = '';

    if (!features || !features.length) {
      host.appendChild(el('div', 'fl-legend-empty', 'Belum ada fitur.'));
      return;
    }

    // Kelompokkan per kategori, catat jenis geometrinya.
    const used = new Map();
    features.forEach(f => {
      if (!used.has(f.category)) {
        used.set(f.category, { lines: 0, polys: 0, points: 0 });
      }
      const u = used.get(f.category);
      if (f.type === 'Marker') u.points++;
      else if (f.type === 'Polyline') u.lines++;
      else u.polys++;
    });

    // Bagian 1: simbol garis / titik
    const lineish = [];
    const polyish = [];
    used.forEach((u, catId) => {
      const cat = catOf(catId);
      const isLine = u.polys === 0 && u.lines > 0;
      const isDot = u.polys === 0 && u.lines === 0;
      if (isLine || isDot) lineish.push({ cat, isLine, isDot });
      else polyish.push({ cat });
    });

    if (lineish.length) {
      const g = el('div', 'fl-legend-group');
      g.appendChild(el('div', 'fl-legend-sub', 'Garis & Titik'));
      lineish.forEach(item => {
        const row = el('div', 'fl-legend-item');
        const sw = el('span', 'fl-legend-swatch ' + (item.isLine ? 'is-line' : 'is-dot'));
        if (item.isLine) sw.style.borderTopColor = item.cat.color;
        else sw.style.background = item.cat.color;
        row.appendChild(sw);
        row.appendChild(el('span', 'fl-legend-label', item.cat.label));
        g.appendChild(row);
      });
      host.appendChild(g);
    }

    if (polyish.length) {
      const g = el('div', 'fl-legend-group');
      g.appendChild(el('div', 'fl-legend-sub', 'Area'));
      polyish.forEach(item => {
        const row = el('div', 'fl-legend-item');
        const sw = el('span', 'fl-legend-swatch');
        sw.style.background = item.cat.color;
        row.appendChild(sw);
        row.appendChild(el('span', 'fl-legend-label', item.cat.label));
        g.appendChild(row);
      });
      host.appendChild(g);
    }
  }

  /* -------------------- Penyegaran menyeluruh -------------------- */
  function refresh() {
    if (!installed) return;
    fillText();
    refreshScaleBar();
    refreshGraticule();
    syncInset();
    buildLegend();
    if (insetMap) { try { insetMap.invalidateSize(); } catch (e) {} }
  }

  function scheduleRefresh() {
    if (!installed) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      refresh();
    });
  }

  /* -------------------- API publik -------------------- */
  return {
    // Dipanggil setiap kali preset berubah.
    activate: function () {
      const wrap = document.getElementById('map-wrap');
      if (!wrap) return;
      ensureSheet();
      installMap();
      initInset();
      // Peta bergerak -> gambar ulang graticule/inset.
      if (map && !map.__formalBound) {
        map.__formalBound = true;
        map.on('move zoom moveend zoomend resize', scheduleRefresh);
        // Perubahan ukuran jendela tidak selalu memicu event Leaflet,
        // jadi diikat juga ke window (debounce lewat scheduleRefresh).
        window.addEventListener('resize', scheduleRefresh);
        // Ukuran panel berubah (mis. scrollbar) -> segarkan skala batang.
        if (typeof ResizeObserver !== 'undefined' && !window.__formalRO) {
          const wrapEl = document.getElementById('map-wrap');
          if (wrapEl) {
            window.__formalRO = new ResizeObserver(scheduleRefresh);
            window.__formalRO.observe(wrapEl);
          }
        }
      }
      scheduleRefresh();
      // Peta butuh ukuran final sebelum digambar.
      setTimeout(refresh, 120);
      setTimeout(refresh, 420);
    },

    deactivate: function () {
      // Lepas listener jendela supaya tidak menumpuk saat preset berganti-ganti.
      window.removeEventListener('resize', scheduleRefresh);
      if (window.__formalRO) {
        try { window.__formalRO.disconnect(); } catch (e) {}
        window.__formalRO = null;
      }
      if (map && map.__formalBound) {
        map.off('move zoom moveend zoomend resize', scheduleRefresh);
        map.__formalBound = false;
      }
      uninstallMap();
      const s = document.querySelector('.formal-sheet');
      if (s && s.parentNode) s.parentNode.removeChild(s);
      built = false;
      sheet = null;
      mapHost = null;
      // DOM lembar dibuang, jadi instance inset ikut mati. Reset penandanya
      // supaya initInset() membangun ulang saat preset diaktifkan lagi.
      if (insetMap) {
        try { insetMap.remove(); } catch (e) { /* diabaikan */ }
      }
      insetMap = null;
      insetBox = null;
      insetReady = false;
    },

    // Dipanggil setelah data fitur berubah (tambah/hapus/edit/ATUR WARNA).
    onFeaturesChanged: function () {
      if (!installed) return;
      buildLegend();
    },

    refresh: refresh,
    scheduleRefresh: scheduleRefresh,

    get insetMap() { return insetMap; },
    isInstalled: function () { return installed; }
  };
})();
