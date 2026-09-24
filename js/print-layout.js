/* ============================================================
   Delinaisi Maker — print-layout.js
   PaperLayout: jembatan ekspor untuk tombol "Gambar PNG" dan
   "Cetak / PDF".

   Rancangan (Opsi B - hybrid):
     - Layout tetap HTML/CSS. Peta & inset tetap instance Leaflet.
     - "Cetak / PDF" memakai window.print() + @media print
       (css/print-layout.css) — tajam, vektor teks, tanpa library.
     - "Gambar PNG" memakai html2canvas (sudah jadi dependensi
       aplikasi ini) untuk meraster seluruh #map-wrap, termasuk
       kanvas graticule dan skala batang SVG.

   Untuk preset "Kop Akademik", ekspor PNG dinaikkan resolusinya
   (scale) supaya teks kecil di panel tetap terbaca di laporan.
   ============================================================ */

'use strict';

const PaperLayout = (function () {

  let busy = false;

  function toastSafe(msg) {
    try { if (typeof toast === 'function') toast(msg); } catch (e) { /* diabaikan */ }
  }

  function isFormal() {
    try {
      return typeof isFormalTpl === 'function' && isFormalTpl(layout.tpl);
    } catch (e) { return false; }
  }

  // Elemen yang tidak boleh ikut terpotret.
  const HIDE_SELECTORS = [
    '#search-box', '#coord-badge', '#measure-badge',
    '.leaflet-control-zoom', '.leaflet-control-attribution',
    '#tile-loader'
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

  // Tunggu tile selesai dimuat supaya PNG tidak berlubang.
  function waitForTiles(timeoutMs) {
    return new Promise(resolve => {
      if (typeof map === 'undefined' || !map) { resolve(); return; }
      const panes = document.querySelectorAll('#map .leaflet-tile-loaded');
      const total = document.querySelectorAll('#map .leaflet-tile').length;
      if (total === 0 || panes.length === total) { resolve(); return; }

      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = setTimeout(finish, timeoutMs || 3500);
      const check = () => {
        const loaded = document.querySelectorAll('#map .leaflet-tile-loaded').length;
        const all = document.querySelectorAll('#map .leaflet-tile').length;
        if (loaded >= all || all === 0) { clearTimeout(timer); finish(); }
      };
      map.once('load', () => { clearTimeout(timer); setTimeout(finish, 120); });
      const iv = setInterval(() => { check(); if (done) clearInterval(iv); }, 150);
    });
  }

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

    const storedY = window.scrollY;
    const hidden = hideChrome();

    waitForTiles(3500).then(() => new Promise(resolve => {
      // Beri kesempatan browser mengecat ulang sebelum dipotret.
      requestAnimationFrame(() => setTimeout(resolve, 180));
    })).then(() => {
      // Preset formal berisi teks kecil -> naikkan resolusi.
      const scale = isFormal() ? 2 : 1;
      return html2canvas(target, {
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        scale: scale,
        scrollX: 0,
        scrollY: -storedY,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight
      });
    }).then(canvas => new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Kanvas kosong')); return; }
        if (typeof downloadBlob === 'function') {
          downloadBlob(blob, isFormal() ? 'peta-kop-akademik.png' : 'peta-delinasi.png');
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'peta-delinasi.png';
          a.click();
        }
        resolve();
      }, 'image/png');
    })).then(() => {
      restoreChrome(hidden);
      busy = false;
      toastSafe('Gambar PNG tersimpan');
    }).catch(err => {
      restoreChrome(hidden);
      busy = false;
      console.error(err);
      toastSafe('Gagal membuat gambar: ' + (err && err.message ? err.message : err));
    });
  }

  function printSheet() {
    // Pastikan peta sudah tergambar penuh sebelum dialog cetak.
    toastSafe('Menyiapkan cetak…');
    waitForTiles(3000).then(() => {
      try { if (map) map.invalidateSize(); } catch (e) { /* diabaikan */ }
      setTimeout(() => window.print(), 160);
    });
  }

  return {
    open: function (mode) {
      if (mode === 'print') printSheet();
      else exportPNG();
    },
    exportPNG: exportPNG,
    print: printSheet
  };
})();

if (typeof window !== 'undefined') window.PaperLayout = PaperLayout;
