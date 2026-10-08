/* ============================================================
   Delinaisi Maker — print-layout.js
   PaperLayout: jembatan ekspor untuk tombol "Gambar PNG" dan
   "Cetak / PDF".

   Rancangan (Opsi B - hybrid):
     - Layout tetap HTML/CSS. Peta & inset tetap instance Leaflet.
     - "Gambar PNG" memakai html2canvas (sudah jadi dependensi
       aplikasi ini) untuk meraster seluruh lembar, termasuk kanvas
       graticule, skala batang SVG, dan ubin peta.
     - "Cetak / PDF" memakai window.print() + @media print
       (css/print-layout.css) — teks tetap vektor, jadi tajam.

   Dua hal yang menentukan gambar tidak "hancur" dan tetap tajam:

   1. html2canvas TIDAK boleh diberi windowWidth/windowHeight/x/y
      sendiri. Opsi itu dipakai untuk menyusun dokumen klon; bila
      ukurannya tidak sama dengan jendela asli, tata letak klon
      bergeser sehingga ubin Leaflet (posisinya dihitung sekali di
      layar lewat inline style translate3d) jatuh ke tempat yang
      salah: peta terlihat bertumpuk/acak. Biarkan html2canvas
      memakai ukuran jendela asli (default-nya).
   2. Saat mencetak, ukuran wadah peta juga tidak boleh berubah.
      Maka lembar dibekukan pada ukuran layarnya lalu diperkecil
      dengan transform: scale() agar pas di area cetak. Transform
      tidak memicu perhitungan ulang tata letak, jadi peta utuh.
   ============================================================ */

'use strict';

const PaperLayout = (function () {

  let busy = false;

  // 1 mm dalam px CSS (96 dpi) — dipakai menghitung area cetak.
  const PX_PER_MM = 96 / 25.4;
  // Margin kertas di semua sisi (sama dengan @page margin).
  const PAGE_MARGIN_MM = 10;
  // Ukuran kertas dalam mm (lebar x tinggi, orientasi tegak).
  // F4 memakai 215 x 330 mm (folio Indonesia).
  const PAPER_SIZES = {
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
    F4: { w: 215, h: 330 },
    Letter: { w: 215.9, h: 279.4 }
  };
  const PAPER_DEFAULT = 'A4';
  // Sisa ruang aman agar isi tidak menyentuh tepi kertas.
  const SAFETY = 0.98;
  // Ketajaman ekspor PNG: 3x piksel CSS -> teks 10px di panel
  // masih terbaca saat gambar dicetak atau di-zoom.
  const PNG_SCALE = 3;

  // Baca pilihan kertas dari state (dengan fallback aman untuk data lama).
  function readPaperChoice() {
    let size = PAPER_DEFAULT;
    let orientation = 'landscape';
    try {
      if (typeof layout !== 'undefined' && layout && layout.kop) {
        const s = String(layout.kop.paperSize || PAPER_DEFAULT).trim();
        // Normalisasi: "letter" -> "Letter", selain itu huruf besar.
        const norm = s.toLowerCase() === 'letter' ? 'Letter' : s.toUpperCase();
        if (PAPER_SIZES[norm]) size = norm;
        const o = String(layout.kop.paperOrientation || 'landscape').toLowerCase();
        orientation = (o === 'portrait' || o === 'tegak') ? 'portrait' : 'landscape';
      }
    } catch (e) { /* pakai bawaan */ }
    return { size: size, orientation: orientation };
  }

  // Spesifikasi kertas terpilih: ukuran penuh + area cetak (minus margin).
  // Selalu dihitung dari tabel, TIDAK dari ukuran layar — inilah yang membuat
  // output PNG/PDF tetap sama di HP maupun desktop.
  function getPaperSpec() {
    const c = readPaperChoice();
    const base = PAPER_SIZES[c.size] || PAPER_SIZES[PAPER_DEFAULT];
    const paperW = (c.orientation === 'portrait') ? base.w : base.h;
    const paperH = (c.orientation === 'portrait') ? base.h : base.w;
    return {
      size: c.size,
      orientation: c.orientation,
      paperW: paperW,
      paperH: paperH,
      printW: paperW - PAGE_MARGIN_MM * 2,
      printH: paperH - PAGE_MARGIN_MM * 2
    };
  }

  // Ukuran stage ekspor dalam px CSS — tetap untuk satu kertas, apa pun viewport.
  function paperStagePx() {
    const spec = getPaperSpec();
    return {
      w: Math.round(spec.printW * PX_PER_MM),
      h: Math.round(spec.printH * PX_PER_MM)
    };
  }

  // Perbarui aturan @page dinamis agar dialog cetak/PDF memakai kertas terpilih.
  // @page ukuran eksplisit (mm) dipakai — bukan nama — supaya F4 ikut didukung
  // (nama F4 tidak ada di spesifikasi CSS). Dipanggil saat pilihan berubah,
  // sebelum cetak, dan sekali saat modul dimuat.
  function syncPageStyle() {
    try {
      const spec = getPaperSpec();
      let st = document.getElementById('dm-page-size');
      if (!st) {
        st = document.createElement('style');
        st.id = 'dm-page-size';
        document.head.appendChild(st);
      }
      st.textContent = '@page { size: ' + spec.paperW + 'mm ' + spec.paperH +
        'mm; margin: ' + PAGE_MARGIN_MM + 'mm; }';
    } catch (e) { /* diabaikan */ }
  }

  function toastSafe(msg) {
    try { if (typeof toast === 'function') toast(msg); } catch (e) { /* diabaikan */ }
  }

  function isFormal() {
    try {
      return typeof isFormalTpl === 'function' ? isFormalTpl(layout.tpl) : true;
    } catch (e) { return true; }
  }

  /* -------------------- Sembunyikan chrome editor -------------------- */
  // Dihilangkan dengan `visibility` (bukan `display`) supaya tata letak
  // tidak bergeser sedikit pun saat dipotret.
  const HIDE_SELECTORS = [
    '#search-box', '#coord-badge', '#measure-badge', '#draw-guide-banner', '#tile-loader',
    '.leaflet-control-zoom', '.leaflet-control-scale',
    '.leaflet-control-attribution', '.leaflet-popup-pane'
  ];

  function hideChrome() {
    const hidden = [];
    HIDE_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (el.style.visibility !== 'hidden') {
          el.dataset.flPrevVis = el.style.visibility || '';
          el.style.visibility = 'hidden';
          hidden.push(el);
        }
      });
    });
    return hidden;
  }

  function restoreChrome(hidden) {
    hidden.forEach(el => {
      el.style.visibility = el.dataset.flPrevVis || '';
      delete el.dataset.flPrevVis;
    });
  }

  /* -------------------- Menunggu gambar siap -------------------- */
  // Ubin & kanvas harus selesai digambar sebelum dipotret/dicetak;
  // kalau tidak, PNG/PDF bisa berlubang atau setengah jadi.
  function waitForTiles(timeoutMs) {
    return new Promise(resolve => {
      if (typeof map === 'undefined' || !map) { resolve(); return; }
      const total = document.querySelectorAll('#map .leaflet-tile').length;
      const loaded = document.querySelectorAll('#map .leaflet-tile-loaded').length;
      if (total === 0 || loaded >= total) { resolve(); return; }

      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = setTimeout(finish, timeoutMs || 4000);
      const iv = setInterval(() => {
        const l = document.querySelectorAll('#map .leaflet-tile-loaded').length;
        const t = document.querySelectorAll('#map .leaflet-tile').length;
        if (l >= t || t === 0) { clearTimeout(timer); clearInterval(iv); finish(); }
      }, 150);
      map.once('load', () => {
        clearTimeout(timer); clearInterval(iv); setTimeout(finish, 140);
      });
    });
  }

  // Beri kesempatan browser mengecat ulang (dua frame + jeda kecil).
  function nextPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)));
    });
  }

  function refreshSheet() {
    try {
      if (typeof FormalSheet !== 'undefined' && FormalSheet.isInstalled() &&
          typeof FormalSheet.refresh === 'function') {
        FormalSheet.refresh();
      }
    } catch (e) { /* diabaikan */ }
  }

  /* -------------------- Panggung cetak -------------------- */
  // Ukuran lembar di layar DIBEKUKAN ke variabel CSS, lalu @media print
  // memakai ukuran itu (lihat css/print-layout.css). Dengan begitu
  // ukuran #map berubah nol -> ubin Leaflet tetap di tempatnya.
  function sheetBox() {
    const sheet = document.querySelector('.formal-sheet') ||
      document.querySelector('#map-wrap');
    if (!sheet) return null;
    const w = Math.round(sheet.offsetWidth || sheet.clientWidth);
    const h = Math.round(sheet.offsetHeight || sheet.clientHeight);
    if (!w || !h) return null;
    return { w: w, h: h };
  }

  function preparePrintStage() {
    const root = document.documentElement;
    if (root.classList.contains('print-ready')) return true;   // sudah siap
    const box = sheetBox();
    if (!box) return false;

    // Aturan @page selalu mengikuti kertas terpilih (bukan A4 tetap).
    syncPageStyle();
    const spec = getPaperSpec();
    const maxW = spec.printW * PX_PER_MM;
    const maxH = spec.printH * PX_PER_MM;
    // Hanya diperkecil seperlunya: lembar yang lebih kecil dari area
    // cetak tidak dibesarkan supaya gambar tidak jadi buram.
    const scale = Math.min(1, maxW / box.w, maxH / box.h) * SAFETY;

    root.style.setProperty('--print-sheet-w', box.w + 'px');
    root.style.setProperty('--print-sheet-h', box.h + 'px');
    root.style.setProperty('--print-scale', String(scale));
    root.style.setProperty('--print-stage-w', Math.ceil(box.w * scale) + 'px');
    root.style.setProperty('--print-stage-h', Math.ceil(box.h * scale) + 'px');
    root.classList.add('print-ready');
    return true;
  }

  function cleanupPrintStage() {
    const root = document.documentElement;
    if (!root.classList.contains('print-ready')) return;
    root.classList.remove('print-ready');
    ['--print-sheet-w', '--print-sheet-h', '--print-scale',
     '--print-stage-w', '--print-stage-h'].forEach(k => root.style.removeProperty(k));
  }

  // Ctrl+P / menu browser juga memakai lembar beku yang sama.
  // beforeprint dijalankan SEBELUM media cetak aktif, jadi ukuran yang
  // terbaca masih ukuran layar — tepat seperti yang dibutuhkan.
  window.addEventListener('beforeprint', () => { syncPageStyle(); preparePrintStage(); });
  window.addEventListener('afterprint', () => { cleanupPrintStage(); });
  // Terapkan @page awal sesuai kertas bawaan (A4 mendatar).
  try { syncPageStyle(); } catch (e) { /* diabaikan */ }

  /* -------------------- Panggung ekspor PNG (ukuran kertas tetap) -------------------- */
  // Lembar dikunci ke ukuran kertas terpilih (px CSS tetap), bukan ukuran layar.
  // Kelas `is-exporting` (lihat css/print-layout.css) memaksa grid desktop sesuai
  // posisi panel — mengabaikan media responsif <900px — supaya hasil di HP sama
  // dengan di desktop. Ukuran #map memang berubah sehingga Leaflet perlu
  // invalidateSize + tunggu ubin; tampilan peta dikembalikan setelah selesai.
  function enterExportStage(stage) {
    const wrap = document.querySelector('#map-wrap');
    if (!wrap || !stage || !stage.w || !stage.h) return null;
    const prev = {
      wrapW: wrap.style.width || '',
      wrapH: wrap.style.height || '',
      wrapFlex: wrap.style.flex || '',
      center: null,
      zoom: null
    };
    try {
      if (typeof map !== 'undefined' && map && map.getCenter) {
        prev.center = map.getCenter();
        prev.zoom = map.getZoom();
      }
    } catch (e) { /* diabaikan */ }
    document.documentElement.classList.add('is-exporting');
    wrap.style.width = stage.w + 'px';
    wrap.style.height = stage.h + 'px';
    wrap.style.flex = 'none';
    try {
      if (typeof map !== 'undefined' && map && map.invalidateSize) map.invalidateSize();
    } catch (e) { /* diabaikan */ }
    refreshSheet();
    return prev;
  }

  function exitExportStage(prev) {
    const wrap = document.querySelector('#map-wrap');
    document.documentElement.classList.remove('is-exporting');
    if (wrap && prev) {
      wrap.style.width = prev.wrapW;
      wrap.style.height = prev.wrapH;
      wrap.style.flex = prev.wrapFlex;
    }
    try {
      if (typeof map !== 'undefined' && map && map.invalidateSize) {
        map.invalidateSize();
        if (prev && prev.center) {
          try { map.setView(prev.center, prev.zoom, { animate: false }); } catch (e) {}
        }
        setTimeout(() => {
          try { map.invalidateSize(); } catch (e) {}
          refreshSheet();
        }, 60);
      } else {
        refreshSheet();
      }
    } catch (e) { /* diabaikan */ }
  }

  function tunggu(ms) {
    return new Promise(resolve => setTimeout(resolve, ms == null ? 350 : ms));
  }

  /* -------------------- Ekspor PNG -------------------- */
  function exportPNG() {
    if (busy) return;
    if (typeof html2canvas === 'undefined') {
      toastSafe('Pustaka gambar belum termuat');
      return;
    }
    const target = document.querySelector('#map-wrap');
    if (!target) return;

    busy = true;
    toastSafe('Membuat gambar peta…');

    const hidden = hideChrome();
    // Kunci ke ukuran kertas: hasil PNG selalu berasio kertas terpilih.
    const stage = paperStagePx();
    const prev = enterExportStage(stage);

    refreshSheet();
    tunggu(380)
      .then(() => waitForTiles(4000))
      .then(nextPaint)
      .then(() => html2canvas(target, {
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        // Tanpa windowWidth/x/y/width/height: html2canvas memakai
        // ukuran jendela asli sehingga klon tidak bergeser.
        scale: PNG_SCALE
      }))
      .then(canvas => new Promise((resolve, reject) => {
        // Pastikan dimensi akhir sesuai kertas (piksel = stage * skala),
        // bukan ukuran viewport saat tombol diklik.
        try {
          const wantW = Math.round(stage.w * PNG_SCALE);
          const wantH = Math.round(stage.h * PNG_SCALE);
          if (canvas.width !== wantW || canvas.height !== wantH) {
            const fixed = document.createElement('canvas');
            fixed.width = wantW;
            fixed.height = wantH;
            const ctx = fixed.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, wantW, wantH);
            // Gambar penuh tanpa distorsi: sumber sudah berasio kertas,
            // jadi cukup salin 1:1 (atau skala bila ada selisih pembulatan).
            ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height,
              0, 0, wantW, wantH);
            fixed.toBlob(blob => {
              if (!blob) { reject(new Error('Kanvas kosong')); return; }
              unduhPng(blob);
              resolve();
            }, 'image/png');
            return;
          }
        } catch (e) { /* jatuh ke jalur normal di bawah */ }
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Kanvas kosong')); return; }
          unduhPng(blob);
          resolve();
        }, 'image/png');
      }))
      .then(() => {
        exitExportStage(prev);
        restoreChrome(hidden);
        busy = false;
        toastSafe('Gambar PNG tersimpan');
      })
      .catch(err => {
        try { exitExportStage(prev); } catch (e2) { /* diabaikan */ }
        restoreChrome(hidden);
        busy = false;
        console.error(err);
        toastSafe('Gagal membuat gambar: ' + (err && err.message ? err.message : err));
      });
  }

  // Nama berkas dipertahankan seperti semula (kontrak test & kebiasaan user).
  function unduhPng(blob) {
    const nama = isFormal() ? 'peta-kop-akademik.png' : 'peta-delinasi.png';
    if (typeof downloadBlob === 'function') {
      downloadBlob(blob, nama);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nama;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  /* -------------------- Cetak / PDF -------------------- */
  function printSheet() {
    if (busy) return;
    busy = true;
    toastSafe('Menyiapkan cetak…');

    const selesai = () => { busy = false; };

    refreshSheet();
    waitForTiles(4000)
      .then(nextPaint)
      .then(() => {
        // Bekukan ukuran lembar lebih dulu; @media print memakainya.
        preparePrintStage();
        window.addEventListener('afterprint', () => {
          cleanupPrintStage();
          selesai();
        }, { once: true });
        // Jaring pengaman: sebagian browser tidak memicu afterprint
        // (mis. dialog ditutup lewat Esc di beberapa versi).
        setTimeout(() => { cleanupPrintStage(); selesai(); }, 120000);
        refreshSheet();
        try { window.print(); } catch (e) { cleanupPrintStage(); selesai(); }
      })
      .catch(err => {
        cleanupPrintStage();
        selesai();
        console.error(err);
        toastSafe('Gagal menyiapkan cetak: ' + (err && err.message ? err.message : err));
      });
  }

  return {
    open: function (mode) {
      if (mode === 'print') printSheet();
      else exportPNG();
    },
    exportPNG: exportPNG,
    print: printSheet,
    preparePrintStage: preparePrintStage,
    cleanupPrintStage: cleanupPrintStage,
    getPaperSpec: getPaperSpec,
    paperStagePx: paperStagePx,
    syncPageStyle: syncPageStyle
  };
})();

if (typeof window !== 'undefined') window.PaperLayout = PaperLayout;
