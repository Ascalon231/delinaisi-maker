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
  let insetLayer = null;     // layer ubin inset
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

  // Isi teks saja — JANGAN menyentuh style.display. Dulu di sini ditulis
  // node.style.display = v ? '' : 'none', yang menghapus keputusan
  // applyBlokPrefs() sehingga toggle "Judul peta" & "Judul kegiatan"
  // tidak berfungsi. Teks kosong sudah disembunyikan lewat CSS :empty.
  function clearText(node, value) {
    if (!node) return;
    if (document.activeElement === node) return; // Jangan timpa jika user sedang mengetik
    const v = (value == null ? '' : String(value)).trim();
    if (node.textContent !== v) {
      node.textContent = v;
    }
  }

  // Pasang kapabilitas inline-editing langsung pada lembar peta (WYSIWYG)
  function setupEditable(node, onInput, singleLine) {
    if (!node || node.__isEditableSetup) return;
    node.__isEditableSetup = true;
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'false');
    node.classList.add('fl-editable');
    node.setAttribute('title', 'Klik untuk mengedit teks langsung');

    node.addEventListener('focus', () => {
      node.classList.add('is-editing');
    });

    node.addEventListener('input', () => {
      const text = (node.innerText || node.textContent || '').trim();
      onInput(text);
    });

    node.addEventListener('keydown', (e) => {
      if (singleLine && e.key === 'Enter') {
        e.preventDefault();
        node.blur();
      }
      if (e.key === 'Escape') {
        node.blur();
      }
    });

    node.addEventListener('blur', () => {
      node.classList.remove('is-editing');
      if (typeof updateLayout === 'function') updateLayout();
      if (typeof save === 'function') save();
    });
  }

  /* -------------------- Membangun kerangka lembar -------------------- */
  function build() {
    if (built) return sheet;
    const k = kop();

    sheet = el('div', 'formal-sheet');

    /* ---- Kolom kiri: peta ---- */
    const mapCol = el('div', 'fl-map-col');
    const frame = el('div', 'fl-map-frame');
    mapHost = el('div', 'fl-map-host');
    const grat = el('canvas', 'fl-graticule-canvas');
    grat.id = 'fl-graticule';
    // Baris kredit sumber peta dasar (atribusi) di tepi bawah peta.
    const credit = el('div', 'fl-map-credit');
    credit.id = 'fl-credit';
    frame.appendChild(mapHost);
    frame.appendChild(grat);
    frame.appendChild(credit);
    mapCol.appendChild(frame);

    /* ---- Kolom kanan: panel informasi ---- */
    const panel = el('div', 'fl-panel');

    // 1. Kop instansi
    const bKop = el('div', 'fl-block fl-kop fl-blk-kop');
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
    const act = el('div', 'fl-block fl-activity fl-blk-activity');
    act.id = 'fl-activity';
    panel.appendChild(act);

    // 3. Judul peta
    const title = el('div', 'fl-block fl-title fl-blk-title');
    title.id = 'fl-title';
    panel.appendChild(title);

    // 4. Blok skala & arah utara (arah utara di kiri, skala di kanan)
    const bScale = el('div', 'fl-block fl-blk-scale');
    const scaleRow = el('div', 'fl-scale-row');
    const compass = FormalLayout.buildCompass(k.northStyle || 'classic', k.northLetter || 'U');
    compass.id = 'fl-compass-host';
    const scaleContent = el('div', 'fl-scale-right fl-scale-left');
    const scaleLabel = el('div', 'fl-scale-label');
    scaleLabel.id = 'fl-scale-label';
    const scaleBarHost = el('div', 'fl-scalebar');
    scaleBarHost.id = 'fl-scalebar';
    scaleContent.appendChild(scaleLabel);
    scaleContent.appendChild(scaleBarHost);
    scaleRow.appendChild(compass);
    scaleRow.appendChild(scaleContent);
    bScale.appendChild(scaleRow);
    panel.appendChild(bScale);

    // 5. Sistem referensi
    const bRef = el('div', 'fl-block fl-blk-ref');
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
    const bInset = el('div', 'fl-block fl-inset-block fl-blk-inset');
    const insetHead = el('div', 'fl-head fl-inset-head', 'Diagram Lokasi:');
    insetHead.id = 'fl-head-inset';
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
    const bLeg = el('div', 'fl-block fl-block--grow fl-blk-legend');
    const legHead = el('div', 'fl-head', 'Legenda:');
    legHead.id = 'fl-head-legend';
    const legBody = el('div', 'fl-legend');
    legBody.id = 'fl-legend';
    bLeg.appendChild(legHead);
    bLeg.appendChild(legBody);
    panel.appendChild(bLeg);

    // 8. Sumber data
    const bSrc = el('div', 'fl-block fl-blk-source');
    const srcHead = el('div', 'fl-head', 'Sumber Data dan Riwayat Peta:');
    srcHead.id = 'fl-head-source';
    const srcBody = el('div', 'fl-source');
    srcBody.id = 'fl-source';
    bSrc.appendChild(srcHead);
    bSrc.appendChild(srcBody);
    panel.appendChild(bSrc);

    // 9. Blok pengesahan
    const bSign = el('div', 'fl-block fl-block--sign fl-blk-sign');
    const sign = el('div', 'fl-sign');
    sign.innerHTML =
      '<div class="fl-sign-know" id="fl-sign-know">Mengetahui,</div>' +
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
  // Logo: tampilkan unggahan user bila ada; jika tidak, placeholder netral.
  function renderLogo() {
    const box = document.querySelector('.fl-kop-logo');
    if (!box) return;
    const k = (layout && layout.kop) || {};
    const url = k.logo || '';
    if (box.dataset.logo === url) return;   // tidak berubah -> jangan sentuh DOM
    box.dataset.logo = url;
    if (url) {
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = url;
      img.alt = k.institution ? ('Logo ' + k.institution) : 'Logo instansi';
      box.appendChild(img);
      box.classList.add('has-logo');
    } else {
      box.classList.remove('has-logo');
      box.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.5" ' +
        'stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M12 2 L20 6 v6 c0 5 -3.4 8.4 -8 10 -4.6 -1.6 -8 -5 -8 -10 V6 z"/>' +
        '<path d="M12 7 v8 M8.5 11 h7"/></svg>';
    }
  }

  function fillText() {
    if (!built) return;
    renderLogo();
    const k = (layout && layout.kop) || {};

    // 1. Perataan teks (Alignment: Left, Center, Right)
    const tAlign = (k.titleAlign || 'center').trim();
    const iAlign = (k.instAlign || 'left').trim();
    const sAlign = (k.signAlign || 'right').trim();

    const titleEl = document.getElementById('fl-title');
    if (titleEl) titleEl.style.textAlign = tAlign;

    const actEl = document.getElementById('fl-activity');
    if (actEl) actEl.style.textAlign = tAlign;

    const kopBlock = document.querySelector('.fl-kop');
    if (kopBlock) kopBlock.dataset.align = iAlign;

    const signBlock = document.querySelector('.fl-sign');
    if (signBlock) signBlock.dataset.align = sAlign;

    // 2. Isi teks ke elemen
    const studyEl = document.getElementById('fl-kop-study');
    const instEl = document.getElementById('fl-kop-inst');
    clearText(studyEl, k.programStudy);
    clearText(instEl, k.institution);

    const year = (k.activityYear || '').trim();
    const act = [(k.activityTitle || '').trim(), year].filter(Boolean).join(' ');
    clearText(actEl, act);

    // Judul peta: fallback ke "Peta Delinasi" supaya blok tidak kosong.
    const title = (layout.title || '').trim() || 'Peta Delinasi';
    clearText(titleEl, title);

    const projEl = document.getElementById('fl-ref-projection');
    const zoneEl = document.getElementById('fl-ref-zone');
    const datumEl = document.getElementById('fl-ref-datum');
    clearText(projEl, k.projection);
    clearText(zoneEl, k.zone);
    clearText(datumEl, k.datum);

    const srcEl = document.getElementById('fl-source');
    clearText(srcEl, k.sourceData);

    const roleEl = document.getElementById('fl-sign-role');
    const studioEl = document.getElementById('fl-sign-studio');
    clearText(roleEl, k.supervisorTitle);
    clearText(studioEl, k.activityTitle);

    const name = (k.mapmakerName || (layout && layout.author) || '').trim();
    const deg = (k.mapmakerDegree || '').trim();
    const nameEl = document.getElementById('fl-sign-name');
    if (nameEl && document.activeElement !== nameEl) {
      nameEl.innerHTML = '';
      nameEl.appendChild(document.createTextNode(name));
      if (deg) {
        const s = el('span', 'fl-sign-degree', ', ' + deg);
        nameEl.appendChild(s);
      }
      // Biarkan CSS yang menyembunyikan bila kosong.
    }

    // 3. Pasang inline editing langsung pada lembar peta
    setupEditable(titleEl, val => {
      if (typeof layout !== 'undefined') layout.title = val;
      const inp = document.getElementById('layout-title');
      if (inp) inp.value = val;
    }, true);

    setupEditable(studyEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.programStudy = val;
      const inp = document.getElementById('kop-programStudy');
      if (inp) inp.value = val;
    }, true);

    setupEditable(instEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.institution = val;
      const inp = document.getElementById('kop-institution');
      if (inp) inp.value = val;
    }, true);

    setupEditable(actEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.activityTitle = val;
      const inp = document.getElementById('kop-activityTitle');
      if (inp) inp.value = val;
    }, true);

    setupEditable(projEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.projection = val;
      const inp = document.getElementById('kop-projection');
      if (inp) inp.value = val;
    }, true);

    setupEditable(zoneEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.zone = val;
      const inp = document.getElementById('kop-zone');
      if (inp) inp.value = val;
    }, true);

    setupEditable(datumEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.datum = val;
      const inp = document.getElementById('kop-datum');
      if (inp) inp.value = val;
    }, true);

    setupEditable(srcEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.sourceData = val;
      const inp = document.getElementById('kop-sourceData');
      if (inp) inp.value = val;
    }, false);

    setupEditable(roleEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.supervisorTitle = val;
      const inp = document.getElementById('kop-supervisorTitle');
      if (inp) inp.value = val;
    }, true);

    setupEditable(studioEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.activityTitle = val;
      const inp = document.getElementById('kop-activityTitle');
      if (inp) inp.value = val;
    }, true);

    setupEditable(nameEl, val => {
      if (typeof layout !== 'undefined') {
        if (layout.kop) layout.kop.mapmakerName = val;
        layout.author = val;
      }
      const inp = document.getElementById('kop-mapmakerName');
      if (inp) inp.value = val;
      const aInp = document.getElementById('layout-author');
      if (aInp) aInp.value = val;
    }, true);

    // 4. Judul-judul komponen dibuat editable (WYSIWYG)
    const insetHead = document.getElementById('fl-head-inset');
    const legHead = document.getElementById('fl-head-legend');
    const srcHead = document.getElementById('fl-head-source');
    const knowEl = document.getElementById('fl-sign-know');

    clearText(insetHead, k.insetLabel || 'Diagram Lokasi:');
    clearText(legHead, k.legendTitle || 'Legenda:');
    clearText(srcHead, k.sourceTitle || 'Sumber Data dan Riwayat Peta:');
    clearText(knowEl, k.signKnowTitle || 'Mengetahui,');

    setupEditable(insetHead, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.insetLabel = val;
      const inp = document.getElementById('kop-inset-label');
      if (inp) inp.value = val;
      if (typeof save === 'function') save('Ubah judul diagram lokasi');
    }, true);

    setupEditable(legHead, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.legendTitle = val;
      if (typeof save === 'function') save('Ubah judul legenda');
    }, true);

    setupEditable(srcHead, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.sourceTitle = val;
      if (typeof save === 'function') save('Ubah judul sumber data');
    }, true);

    setupEditable(knowEl, val => {
      if (typeof layout !== 'undefined' && layout.kop) layout.kop.signKnowTitle = val;
      if (typeof save === 'function') save('Ubah teks pengesahan');
    }, true);

    // Skala numerik & arah utara diperbarui di refreshScaleBar()
  }

  /* -------------------- Skala batang & arah utara -------------------- */
  function refreshScaleBar() {
    const k = kop();

    // 1. Perbarui arah utara sesuai preferensi style & huruf
    const compassHost = document.getElementById('fl-compass-host');
    if (compassHost) {
      const newCompass = FormalLayout.buildCompass(k.northStyle || 'classic', k.northLetter || 'U');
      compassHost.innerHTML = newCompass.innerHTML;
      compassHost.className = newCompass.className;
    }

    // 2. Skala numerik
    const label = document.getElementById('fl-scale-label');
    if (label && map) {
      let rf;
      if (k.scaleMode === 'custom' && k.scaleCustom) {
        let clean = String(k.scaleCustom);
        if (clean.includes(':')) {
          const parts = clean.split(':');
          clean = parts[parts.length - 1];
        }
        rf = Number(clean.replace(/[^0-9]/g, '')) || 25000;
      } else {
        rf = FormalLayout.representativeFraction(map);
      }
      label.textContent = 'SKALA: 1:' + FormalLayout.fmtNumber(rf);

      setupEditable(label, val => {
        let clean = String(val);
        if (clean.includes(':')) {
          const parts = clean.split(':');
          clean = parts[parts.length - 1];
        }
        const num = Number(clean.replace(/[^0-9]/g, ''));
        if (num && typeof aturSkalaPeta === 'function') {
          aturSkalaPeta(num);
        }
      }, true);
    }

    // 3. Skala batang grafis
    const host = document.getElementById('fl-scalebar');
    if (!host) return;
    const row = host.closest('.fl-scale-row');
    const kompas = row ? (row.querySelector('.fl-compass') || row.querySelector('#fl-compass-host')) : null;
    let width = host.clientWidth || 0;
    if (row && kompas) {
      const gap = 8;
      const tersedia = row.clientWidth - kompas.offsetWidth - gap;
      if (tersedia > 0) width = Math.min(width || tersedia, tersedia);
    }
    if (!width || width < 60) width = 160;
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
    const gridPos = (kop() && kop().gridPos) || 'inside';
    const isOutside = gridPos === 'outside';
    const hadOutside = frame.classList.contains('grid-outside');
    frame.classList.toggle('grid-outside', isOutside);
    if (hadOutside !== isOutside && map && typeof map.invalidateSize === 'function') {
      map.invalidateSize({ debounceMoveend: true });
    }

    FormalLayout.drawGraticule(ctx, map, { x: w, y: h }, {
      labelPosition: gridPos,
      margin: isOutside ? { top: 20, bottom: 20, left: 58, right: 58 } : 0
    });
  }

  /* -------------------- Blok yang bisa disembunyikan & diurutkan -------------------- */
  // Setiap blok panel bisa ditampilkan/disembunyikan serta diubah urutannya
  // oleh pengguna. Blok kustom baru juga akan terdaftar secara dinamis.
  const BASE_BLOK = [
    { id: 'kop',      sel: '.fl-blk-kop',      label: 'Kop Lembaga / Instansi & Logo' },
    { id: 'activity', sel: '.fl-blk-activity', label: 'Judul Kegiatan / Proyek' },
    { id: 'title',    sel: '.fl-blk-title',    label: 'Judul Lembar Peta' },
    { id: 'scale',    sel: '.fl-blk-scale',    label: 'Skala & Arah Mata Angin' },
    { id: 'ref',      sel: '.fl-blk-ref',      label: 'Sistem Koordinat & Proyeksi' },
    { id: 'inset',    sel: '.fl-blk-inset',    label: 'Diagram Lokasi (Peta Inset)' },
    { id: 'legend',   sel: '.fl-blk-legend',   label: 'Legenda Simbol & Fitur' },
    { id: 'source',   sel: '.fl-blk-source',   label: 'Sumber Data & Riwayat' },
    { id: 'sign',     sel: '.fl-blk-sign',     label: 'Pengesahan & Pembuat Peta' },
    { id: 'grid',     sel: '#fl-graticule',    label: 'Grid Koordinat Peta Utama' }
  ];

  function getAllBlok() {
    const list = [...BASE_BLOK];
    const k = kop();
    const custom = (k && k.customBlocks) || [];
    custom.forEach(c => {
      list.push({
        id: c.id,
        sel: `[data-custom-id="${c.id}"]`,
        label: c.title ? c.title.replace(/:$/, '') : 'Bagian kustom',
        isCustom: true
      });
    });
    return list;
  }

  // Sinkronkan bagian kustom buatan pengguna ke DOM lembar
  function syncCustomBlocks() {
    const panel = document.querySelector('.fl-panel');
    if (!panel) return;
    const k = kop();
    const customList = k.customBlocks || [];

    // Hapus blok kustom di DOM yang sudah dihapus dari data
    panel.querySelectorAll('.fl-blk-custom').forEach(el => {
      const cid = el.dataset.customId;
      if (!customList.some(c => c.id === cid)) {
        el.remove();
      }
    });

    // Buat / perbarui blok kustom yang ada di data
    customList.forEach(c => {
      let bCustom = panel.querySelector(`[data-custom-id="${c.id}"]`);
      if (!bCustom) {
        bCustom = el('div', 'fl-block fl-blk-custom fl-custom-block');
        bCustom.dataset.customId = c.id;

        const head = el('div', 'fl-head fl-custom-head');
        head.textContent = c.title || 'Keterangan Tambahan:';
        setupEditable(head, val => {
          c.title = val;
          if (typeof save === 'function') save('Ubah judul bagian kustom');
        }, true);
        head.addEventListener('blur', () => {
          if (typeof renderBlokToggles === 'function') renderBlokToggles();
        });

        const body = el('div', 'fl-custom-body');
        body.textContent = c.content || 'Tulis catatan atau keterangan tambahan di sini...';
        setupEditable(body, val => {
          c.content = val;
          if (typeof save === 'function') save('Ubah isi bagian kustom');
        }, false);

        bCustom.appendChild(head);
        bCustom.appendChild(body);
        panel.appendChild(bCustom);
      } else {
        const head = bCustom.querySelector('.fl-custom-head');
        const body = bCustom.querySelector('.fl-custom-body');
        if (head && document.activeElement !== head) {
          head.textContent = c.title || 'Keterangan Tambahan:';
        }
        if (body && document.activeElement !== body) {
          body.textContent = c.content || '';
        }
      }
    });
  }

  // Tata urutan elemen anak pada panel lembar kop sesuai layout.kop.blokOrder
  function applyBlokOrder() {
    const panel = document.querySelector('.fl-panel');
    if (!panel) return;
    const k = kop();
    const all = getAllBlok();
    const order = (k.blokOrder && k.blokOrder.length) ? k.blokOrder : all.map(b => b.id);

    order.forEach(id => {
      const b = all.find(item => item.id === id);
      if (!b || !b.sel) return;
      const target = panel.querySelector(b.sel);
      if (target && target.parentNode === panel) {
        panel.appendChild(target);
      }
    });
  }

  // Terapkan preferensi tampil/sembunyi ke seluruh blok (standar + kustom).
  function applyBlokPrefs() {
    const k = kop();
    const blokVis = (k.blokVis && typeof k.blokVis === 'object') ? k.blokVis : {};
    getAllBlok().forEach(b => {
      const e = document.querySelector(b.sel);
      if (!e) return;
      // Default: tampil. Hanya disembunyikan bila user mematikannya.
      const tampil = blokVis[b.id] !== false;
      e.style.display = tampil ? '' : 'none';
    });
  }

  /* -------------------- Preferensi inset (dari input user) ------------- */
  function kop() { return (typeof layout !== 'undefined' && layout.kop) || {}; }

  // URL ubin inset sesuai pilihan user. Semua sumber bebas API key; untuk
  // 'follow' dipakai peta dasar utama, dan 'none' jatuh ke Jalan (OSM).
  function insetTileUrl() {
    const want = kop().insetBasemap || 'streets';
    const id = (want === 'follow') ? (typeof currentBasemap !== 'undefined' ? currentBasemap : 'streets') : want;
    const safe = (id === 'none' || !id || (typeof BASEMAPS !== 'undefined' && !BASEMAPS[id])) ? 'streets' : id;
    const bm = (typeof BASEMAPS !== 'undefined') ? BASEMAPS[safe] : null;
    if (bm && bm._url) return bm._url;
    return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  }

  function insetColor() { return kop().insetColor || '#e01b1b'; }

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

    insetLayer = L.tileLayer(insetTileUrl(), {
      maxZoom: 19,
      subdomains: 'abcd',
      crossOrigin: true
    }).addTo(insetMap);

    insetMap.setView([-2.5, 118], 5);
    insetBox = L.rectangle([[0, 0], [0, 0]], {
      color: insetColor(),
      weight: 1.8,
      fillColor: insetColor(),
      fillOpacity: 0.18,
      interactive: false
    }).addTo(insetMap);

    // Saat inset bergerak/selesai digeser, selaraskan kanvas graticule
    insetMap.on('move zoom moveend zoomend', () => {
      refreshInsetGraticule();
    });

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
      if (!b || !b.isValid()) return;
      insetBox.setBounds(b);
      if (insetBox.bringToFront) insetBox.bringToFront();

      // Skala perbesaran inset sesuai dropdown:
      // '2' = Sangat luas (negara/makro) -> target zoom 3
      // '4' = Luas (provinsi/pulau)      -> target zoom 5
      // '6' = Sedang (regional)          -> target zoom 7
      // '8' = Dekat (kabupaten/kota)     -> target zoom 9
      const val = kop().insetZoom;
      const zoomMap = { '2': 3, '4': 5, '6': 7, '8': 9 };
      const parsed = parseInt(val, 10);
      const targetZoom = (val in zoomMap) ? zoomMap[val] : (isFinite(parsed) ? parsed : 5);

      // Inset wajib selalu lebih luas (zoom-out) dari peta utama, minimal 1 tingkat
      const maxAllowed = Math.max(1, map.getZoom() - 1);
      const finalZoom = Math.max(1, Math.min(targetZoom, maxAllowed));

      insetMap.setView(b.getCenter(), finalZoom, { animate: false });
      // Grid inset ikut berubah saat cakupan berubah.
      refreshInsetGraticule();
    } catch (e) { /* diabaikan */ }
  }

  // Terapkan preferensi tampilan inset (tinggi, tampil/sembunyi, judul).
  function applyInsetPrefs() {
    const k = kop();

    const wrap = document.querySelector('.fl-inset-wrap');
    if (wrap) {
      const h = parseInt(k.insetHeight, 10);
      const newH = (isFinite(h) ? h : 150) + 'px';
      if (wrap.style.height !== newH) {
        wrap.style.height = newH;
        if (insetMap) {
          try { insetMap.invalidateSize(); } catch (e) {}
        }
      }
    }

    // PENTING: bagian ini TIDAK mengatur display blok inset. Dulu di sini
    // ditulis block.style.display = '', yang menimpa keputusan
    // applyBlokPrefs() sehingga toggle "Diagram lokasi" tidak berfungsi.
    // Yang diatur di sini hanya isi & judulnya.
    const head = document.querySelector('.fl-inset-head');
    const show = k.insetShow !== false;
    if (head) {
      const label = (k.insetLabel == null ? 'Diagram Lokasi:' : k.insetLabel).trim();
      head.textContent = label;
      head.style.display = (label && show) ? '' : 'none';
    }

    // Grid DALAM inset bisa dimatikan (terpisah dari grid peta utama).
    const g = document.getElementById('fl-inset-graticule');
    const wantGrid = String(k.insetGrid !== '0');
    if (g) g.style.display = (show && wantGrid === 'true') ? '' : 'none';

    if (insetBox) {
      const c = insetColor();
      insetBox.setStyle({ color: c, fillColor: c });
    }
  }

  /* -------------------- Graticule inset -------------------- */
  // Inset juga diberi grid koordinat (spesifikasi: "plus grid koordinat"),
  // dengan langkah lebih jarang dan label ringkas karena area lebih luas.
  function refreshInsetGraticule() {
    const cvs = document.getElementById('fl-inset-graticule');
    if (!cvs || !insetReady || !insetMap) return;
    if (String(kop().insetGrid) === '0') return;   // display diatur applyInsetPrefs

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
    const step = Math.min(Math.max(FormalLayout.intervalFor(insetMap.getZoom()), 0.5), 10);
    FormalLayout.drawGraticule(ctx, insetMap, { x: w, y: h }, {
      step: step,
      fontSize: 8,
      showEdgeLabels: false,
      labelPosition: 'inside',
      color: 'rgba(30,30,30,.35)'
    });
  }

  /* -------------------- Legenda otomatis -------------------- */
  // Dibangun dari kategori unik yang benar-benar dipakai fitur user.
  function buildLegend() {
    const host = document.getElementById('fl-legend');
    if (!host) return;
    host.innerHTML = '';

    const adminLoaded = (typeof AdminBoundaries !== 'undefined' && AdminBoundaries.hasData());

    // Legenda boleh kosong hanya bila tidak ada fitur DAN tidak ada batas
    // administrasi yang dimuat — batas juga tampil di peta, jadi wajib
    // dijelaskan di lembar cetak.
    if ((!features || !features.length) && !adminLoaded) {
      host.appendChild(el('div', 'fl-legend-empty', 'Belum ada fitur.'));
      return;
    }

    // Kelompokkan per kategori, catat jenis geometrinya.
    const used = new Map();
    (features || []).forEach(f => {
      const catObj = typeof catOf === 'function' ? catOf(f.category) : null;
      const catId = catObj ? catObj.id : (f.category || 'lainnya');
      if (!used.has(catId)) {
        used.set(catId, { lines: 0, polys: 0, points: 0, cat: catObj });
      }
      const u = used.get(catId);
      if (f.type === 'Marker') u.points++;
      else if (f.type === 'Polyline') u.lines++;
      else u.polys++;
    });

    // Bagian 1: simbol garis / titik
    const lineish = [];
    const polyish = [];
    used.forEach((u, catId) => {
      const cat = u.cat || (typeof catOf === 'function' ? catOf(catId) : { id: catId, label: catId, color: '#6c757d' });
      const isLine = u.polys === 0 && u.lines > 0;
      const isDot = u.polys === 0 && u.lines === 0;
      if (isLine || isDot) lineish.push({ cat, isLine, isDot });
      else polyish.push({ cat });
    });

    // Opsi tampilkan ukuran (luas/panjang) di legenda
    const showMeasure = !!(kop() && kop().legendShowMeasure);
    const catStats = new Map();
    if (showMeasure) {
      (features || []).forEach(f => {
        const catObj = typeof catOf === 'function' ? catOf(f.category) : null;
        const catId = catObj ? catObj.id : (f.category || 'lainnya');
        if (!catStats.has(catId)) {
          catStats.set(catId, { totalArea: 0, totalLen: 0, count: 0 });
        }
        const st = catStats.get(catId);
        st.count++;
        if (f.measure) {
          if (f.measure.area != null && isFinite(f.measure.area)) st.totalArea += f.measure.area;
          if (f.measure.length != null && isFinite(f.measure.length)) st.totalLen += f.measure.length;
        } else if (f.layer && typeof turf !== 'undefined') {
          try {
            const gj = f.layer.toGeoJSON();
            if (f.type === 'Polygon' || f.type === 'Rectangle') st.totalArea += turf.area(gj);
            else if (f.type === 'Polyline') st.totalLen += turf.length(gj, { units: 'kilometers' }) * 1000;
          } catch (e) {}
        }
      });
    }

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
        if (showMeasure) {
          const st = catStats.get(item.cat.id);
          if (st) {
            if (item.isLine && st.totalLen > 0 && typeof fmtLen === 'function') {
              row.appendChild(el('span', 'fl-legend-measure', ' · ' + fmtLen(st.totalLen)));
            } else if (item.isDot && st.count > 0) {
              row.appendChild(el('span', 'fl-legend-measure', ' · ' + st.count + ' titik'));
            }
          }
        }
        g.appendChild(row);
      });
      host.appendChild(g);
    }

    // Batas administrasi yang dimuat user ikut masuk legenda, karena
    // garisnya tampil di peta dan wajib dijelaskan di lembar cetak.
    if (adminLoaded) {
      const g = el('div', 'fl-legend-group');
      g.appendChild(el('div', 'fl-legend-sub', 'Batas Administrasi'));
      const row = el('div', 'fl-legend-item');
      const sw = el('span', 'fl-legend-swatch is-line');
      sw.style.borderTopColor = '#1f2d3d';
      sw.style.borderTopStyle = 'dashed';
      row.appendChild(sw);
      const nm = AdminBoundaries.current ? AdminBoundaries.current.short : 'Batas wilayah';
      row.appendChild(el('span', 'fl-legend-label', nm));
      g.appendChild(row);
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
        if (showMeasure) {
          const st = catStats.get(item.cat.id);
          if (st && st.totalArea > 0 && typeof fmtArea === 'function') {
            row.appendChild(el('span', 'fl-legend-measure', ' · ' + fmtArea(st.totalArea)));
          }
        }
        g.appendChild(row);
      });
      host.appendChild(g);
    }
  }

  /* -------------------- Penyegaran menyeluruh -------------------- */
  function refresh() {
    if (!installed) return;
    syncCustomBlocks();
    applyBlokOrder();
    applyInsetPrefs();
    fillText();
    refreshScaleBar();
    refreshGraticule();
    syncInset();
    buildLegend();
    // Diterapkan TERAKHIR: fungsi-fungsi di atas boleh mengubah isi, tapi
    // keputusan tampil/sembunyi tiap bagian harus jadi penentu akhir.
    applyBlokPrefs();
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
      insetLayer = null;
      insetReady = false;
    },

    // Dipanggil setelah data fitur berubah (tambah/hapus/edit/ATUR WARNA).
    onFeaturesChanged: function () {
      if (!installed) return;
      buildLegend();
    },

    refresh: refresh,
    scheduleRefresh: scheduleRefresh,
    get BLOK() { return getAllBlok(); },

    // Dipanggil saat user mengubah opsi inset: ganti ubin bila perlu.
    applyInsetOptions: function () {
      if (!installed) return;
      const wantUrl = insetTileUrl();
      if (insetLayer && insetLayer._url !== wantUrl) {
        try { insetMap.removeLayer(insetLayer); } catch (e) {}
        insetLayer = L.tileLayer(wantUrl, {
          maxZoom: 19, subdomains: 'abcd', crossOrigin: true
        }).addTo(insetMap);
        if (insetBox) insetBox.bringToFront();
      }
      scheduleRefresh();
    },

    get insetMap() { return insetMap; },
    isInstalled: function () { return installed; }
  };
})();
