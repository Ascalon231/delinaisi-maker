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
  // Area cetak A4 lanskap dengan margin 10mm (297-20 x 210-20 mm).
  const PAGE_MM = { w: 277, h: 190 };
  // Sisa ruang aman agar isi tidak menyentuh tepi kertas.
  const SAFETY = 0.98;
  // Ketajaman ekspor PNG: 3x piksel layar -> teks 10px di panel
  // masih terbaca saat gambar dicetak atau di-zoom.
  const PNG_SCALE = 3;

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
    '#search-box', '#coord-badge', '#measure-badge', '#tile-loader',
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

    const maxW = PAGE_MM.w * PX_PER_MM;
    const maxH = PAGE_MM.h * PX_PER_MM;
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
  window.addEventListener('beforeprint', () => { preparePrintStage(); });
  window.addEventListener('afterprint', () => { cleanupPrintStage(); });

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

    refreshSheet();
    waitForTiles(4000)
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
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Kanvas kosong')); return; }
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
          resolve();
        }, 'image/png');
      }))
      .then(() => {
        restoreChrome(hidden);
        busy = false;
        toastSafe('Gambar PNG tersimpan');
      })
      .catch(err => {
        restoreChrome(hidden);
        busy = false;
        console.error(err);
        toastSafe('Gagal membuat gambar: ' + (err && err.message ? err.message : err));
      });
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
    cleanupPrintStage: cleanupPrintStage
  };
})();

if (typeof window !== 'undefined') window.PaperLayout = PaperLayout;
