/* ============================================================
   Delinaisi Maker — history.js
   Riwayat (undo/redo) + cadangan otomatis.

   Pendekatan: snapshot state penuh (fitur + layout + kop + kategori)
   disimpan di memori dengan batas jumlah. Snapshot dipilih daripada
   command-pattern karena jauh lebih sederhana dan tahan terhadap
   perubahan bentuk yang dilakukan Leaflet.draw (yang sulit direkam
   sebagai aksi terpisah).

   Batas 40 langkah dengan ukuran maksimum, supaya memori tetap wajar
   meski poligon berisi ribuan titik.

   Cadangan: satu salinan terpisah di localStorage. Kalau penyimpanan
   utama rusak/penuh, pengguna masih bisa memulihkan pekerjaannya.
   ============================================================ */

'use strict';

const History = (function () {

  const MAX_STEPS = 40;
  const MAX_BYTES = 2 * 1024 * 1024;   // batas total riwayat di memori

  let stack = [];      // daftar snapshot, index 0 = paling lama
  let cursor = -1;     // posisi snapshot yang sedang aktif
  let suspended = false;   // true saat sedang memulihkan (jangan rekam)
  let lastHash = null;

  /* -------------------- Utilitas -------------------- */
  // Hash ringan untuk mendeteksi perubahan nyata. Tanpa ini, setiap
  // panggilan save() akan membuat langkah riwayat walau isinya sama
  // (mis. hanya karena peta digeser).
  function hashOf(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  function totalBytes() {
    let n = 0;
    for (let i = 0; i < stack.length; i++) n += stack[i].raw.length;
    return n;
  }

  function trim() {
    // Buang langkah terlama sampai jumlah & ukuran kembali wajar.
    while (stack.length > MAX_STEPS) {
      stack.shift();
      cursor--;
    }
    while (totalBytes() > MAX_BYTES && stack.length > 2) {
      stack.shift();
      cursor--;
    }
    if (cursor < 0) cursor = 0;
  }

  /* -------------------- API -------------------- */
  return {
    // Rekam satu keadaan. `raw` = string JSON state (dipakai untuk
    // membandingkan & menyimpan), `label` = keterangan untuk UI.
    push: function (raw, label) {
      if (suspended || typeof raw !== 'string') return false;

      const h = hashOf(raw);
      if (h === lastHash && stack.length) return false;   // tidak ada perubahan

      // Buang cabang "redo" bila kita berada di tengah riwayat.
      if (cursor < stack.length - 1) stack = stack.slice(0, cursor + 1);

      stack.push({ raw: raw, h: h, label: label || '', at: Date.now() });
      cursor = stack.length - 1;
      lastHash = h;
      trim();
      this.onChange();
      return true;
    },

    // Paksa rekam walau isinya sama (mis. titik awal dokumen).
    reset: function (raw, label) {
      stack = [];
      cursor = -1;
      lastHash = null;
      this.push(raw, label || 'Awal');
    },

    canUndo: function () { return cursor > 0; },
    canRedo: function () { return cursor < stack.length - 1; },

    // Kembalikan raw state sebelumnya/berikutnya, atau null.
    undo: function () {
      if (!this.canUndo()) return null;
      cursor--;
      const s = stack[cursor];
      lastHash = s.h;
      this.onChange();
      return s.raw;
    },

    redo: function () {
      if (!this.canRedo()) return null;
      cursor++;
      const s = stack[cursor];
      lastHash = s.h;
      this.onChange();
      return s.raw;
    },

    // Dipakai saat memulihkan: cegah snapshot baru terbentuk dari
    // proses pemulihan itu sendiri.
    runSuspended: function (fn) {
      suspended = true;
      try { fn(); } finally { suspended = false; }
    },

    currentLabel: function () {
      const s = stack[cursor];
      return s ? s.label : '';
    },

    nextUndoLabel: function () {
      const s = stack[cursor - 1];
      return s ? s.label : '';
    },

    depth: function () { return { pos: cursor + 1, total: stack.length }; },

    // Callback yang dipasang UI untuk memperbarui tombol.
    onChange: function () {}
  };
})();

/* ============================================================
   Cadangan otomatis (localStorage terpisah)
   ============================================================ */
const Backup = (function () {
  const KEY = 'delinaisi-maker-backup-v1';
  const MAX_BYTES = 3 * 1024 * 1024;
  let timer = null;

  return {
    // Simpan salinan berkala (ditunda agar tidak menulis terus-menerus).
    schedule: function (raw) {
      if (typeof raw !== 'string' || raw.length > MAX_BYTES) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(KEY, JSON.stringify({
            t: Date.now(),
            v: 1,
            raw: raw
          }));
        } catch (e) { /* kuota penuh: biarkan, yang utama tetap aman */ }
      }, 2500);
    },

    read: function () {
      try {
        const d = JSON.parse(localStorage.getItem(KEY));
        if (!d || typeof d.raw !== 'string') return null;
        return { at: d.t || 0, raw: d.raw };
      } catch (e) { return null; }
    },

    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})();

if (typeof window !== 'undefined') {
  window.History = History;
  window.Backup = Backup;
}
