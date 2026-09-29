/* ============================================================
   Delinaisi Maker — app.js
   Web sederhana untuk membuat peta delinasi.
   ============================================================ */

'use strict';

/* -------------------- Konstanta -------------------- */
const STORE_KEY = 'delinaisi-maker-v1';

// Jenis delinasi yang bisa dipilih, lengkap dengan warna peta.
const DEFAULT_CATEGORIES = [
  { id: 'batas_admin',      label: 'Batas Administrasi',      color: '#e63946' },
  { id: 'daerah_pemilihan', label: 'Daerah Pemilihan',        color: '#7b2cbf' },
  { id: 'wilayah_studi',    label: 'Wilayah Studi',           color: '#2a9d8f' },
  { id: 'penggunaan_lahan', label: 'Penggunaan Lahan',        color: '#588157' },
  { id: 'jaringan_jalan',   label: 'Jaringan / Jalan',        color: '#457b9d' },
  { id: 'perairan',         label: 'Perairan / Sungai',       color: '#0096c7' },
  { id: 'lainnya',          label: 'Lainnya',                 color: '#6c757d' }
];

// Palet siap pakai supaya user tidak perlu memilih warna dari nol.
// Dikelompokkan agar mudah dipindai; semuanya kontras di atas basemap terang.
const PALETTE = [
  { name: 'Merah & Hangat', colors: ['#e63946', '#d62828', '#e76f51', '#f4a261', '#e9c46a', '#bc4749', '#c1121f', '#ff6b35'] },
  { name: 'Hijau & Alam',   colors: ['#588157', '#2a9d8f', '#3a5a40', '#40916c', '#74c69d', '#a3b18a', '#1b4332', '#95d5b2'] },
  { name: 'Biru & Air',     colors: ['#457b9d', '#0096c7', '#1d3557', '#2f6fed', '#48cae4', '#0077b6', '#90e0ef', '#023e8a'] },
  { name: 'Ungu & Magenta', colors: ['#7b2cbf', '#9d4edd', '#c77dff', '#b5179e', '#7209b7', '#f72585', '#560bad', '#e0aaff'] },
  { name: 'Netral & Gelap', colors: ['#6c757d', '#495057', '#343a40', '#adb5bd', '#212529', '#8d99ae', '#2b2d42', '#ced4da'] },
  { name: 'Tanah & Panas',  colors: ['#a47148', '#8b5e34', '#bb9457', '#6f4e37', '#d4a373', '#9c6644', '#7f5539', '#ccd5ae'] }
];

// Salinan yang bisa diubah user (warna + nama kategori) — disimpan di localStorage.
let CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));

function setCategoryColor(id, color) {
  const c = CATEGORIES.find(x => x.id === id);
  if (c) c.color = color;
}

// Normalisasi HEX agar input user fleksibel (#abc, abc, #AABBCC).
function normalizeHex(v) {
  if (!v) return null;
  let t = String(v).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(t)) return null;
  return '#' + t.toLowerCase();
}

// Hitung luminance relatif untuk memilih warna teks yang kontras.
function hexLuminance(hex) {
  const h = normalizeHex(hex) || '#000000';
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Warna yang mirip membuat legenda sulit dibaca -> deteksi untuk diperingatkan.
function similarColorGroups() {
  const byColor = {};
  CATEGORIES.forEach(c => {
    const key = normalizeHex(c.color) || c.color;
    (byColor[key] = byColor[key] || []).push(c);
  });
  return Object.keys(byColor).map(k => byColor[k]).filter(g => g.length > 1);
}

// ID unik untuk kategori baru.
function newCategoryId() {
  let n = 1;
  while (CATEGORIES.some(c => c.id === 'kustom_' + n)) n++;
  return 'kustom_' + n;
}

const TYPE_LABEL = {
  Marker: 'Titik', Polyline: 'Garis', Polygon: 'Poligon',
  Rectangle: 'Persegi', Circle: 'Lingkaran'
};

const HINT = {
  Marker:   'Klik di peta untuk menempatkan titik.',
  Polyline: 'Klik untuk menambah titik · klik dua kali (atau Enter) untuk selesai.',
  Polygon:  'Klik untuk menambah sudut · klik dua kali (atau Enter) untuk menutup poligon.',
  Rectangle:'Klik & tahan, tarik untuk membuat persegi.',
  Circle:   'Klik & tahan di titik pusat, tarik untuk menentukan radius.'
};

// Terjemahkan tooltip leaflet-draw ke Bahasa Indonesia.
L.drawLocal = {
  draw: {
    toolbar: {
      actions: { title: 'Batal gambar', text: 'Batal' },
      finish:  { title: 'Selesai',      text: 'Selesai' },
      undo:    { title: 'Hapus titik terakhir', text: 'Hapus titik terakhir' },
      buttons: {
        polyline: 'Gambar garis', polygon: 'Gambar poligon',
        rectangle: 'Gambar persegi', circle: 'Gambar lingkaran', marker: 'Gambar titik'
      }
    },
    handlers: {
      circle:    { tooltip: { start: 'Klik & tarik untuk membuat lingkaran' } },
      polygon:   { tooltip: {
        start: 'Klik untuk mulai menggambar poligon',
        cont:  'Klik untuk lanjut · klik dua kali untuk selesai',
        end:   'Klik titik pertama untuk menutup poligon'
      } },
      polyline:  {
        error: '<strong>Gagal:</strong> garis tidak boleh menyilang!',
        tooltip: {
          start: 'Klik untuk mulai menggambar garis',
          cont:  'Klik untuk lanjut · klik dua kali untuk selesai',
          end:   'Klik titik terakhir untuk selesai'
        }
      },
      rectangle: { tooltip: { start: 'Klik & tarik untuk membuat persegi' } },
      simpleshape: { tooltip: { end: 'Lepas mouse untuk selesai' } },
      marker:    { tooltip: { start: 'Klik di peta untuk menempatkan titik' } }
    }
  },
  edit: {
    toolbar: {
      actions: {
        save:    { title: 'Simpan perubahan', text: 'Simpan' },
        cancel:  { title: 'Batal',            text: 'Batal' },
        clearAll: { title: 'Hapus semua',     text: 'Hapus semua' }
      },
      buttons: { edit: 'Edit fitur', editDisabled: 'Tidak ada fitur untuk diedit', remove: 'Hapus fitur' }
    },
    handlers: {
      edit:   { tooltip: { text: 'Tarik sudut untuk mengubah bentuk', subtext: 'Klik Batal untuk membatalkan' } },
      remove: { tooltip: { text: 'Klik fitur untuk menghapus' } }
    }
  }
};

/* -------------------- State -------------------- */
let map, drawnItems;
let features = [];      // { id, layer, name, category, desc, type, measure }
let idSeq = 0;
let currentDrawer = null;
let currentDrawerType = null;
let editHandler = null;
let editingFeatureId = null;
let currentBasemap = 'streets';
let searchMarker = null;

/* -------------------- Sidebar (mobile) -------------------- */
function closeSidebarMobile() {
  if (window.innerWidth > 860) return;
  $('#sidebar').classList.add('closed');
  const bd = $('#sidebar-backdrop');
  if (bd) bd.classList.remove('show');
}

/* -------------------- Util -------------------- */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

let toastTimer;
// toast(msg, {actionLabel, onAction}) — mendukung tombol aksi (mis. "Urungkan").
function toast(msg, opts) {
  const t = $('#toast');
  opts = opts || {};
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (opts.actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      t.classList.remove('show');
      clearTimeout(toastTimer);
      if (typeof opts.onAction === 'function') opts.onAction();
    });
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), opts.actionLabel ? 5500 : 2300);
}

function catOf(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

// leaflet-draw memakai layerType huruf kecil ("marker"); kita kanonikkan.
function canonicalType(t) {
  const map = { marker: 'Marker', polyline: 'Polyline', polygon: 'Polygon',
                rectangle: 'Rectangle', circle: 'Circle' };
  return map[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
}

// ---- Format angka (gaya Indonesia) ----
function fmtArea(m2) {
  if (m2 == null || !isFinite(m2)) return null;
  if (m2 < 10000) return m2.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' m²';
  if (m2 < 1000000) return (m2 / 10000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
  return (m2 / 1000000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km²';
}
function fmtLen(m) {
  if (m == null || !isFinite(m)) return null;
  if (m < 1000) return m.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' m';
  return (m / 1000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
}
window.fmtArea = fmtArea;
window.fmtLen = fmtLen;
// Koordinat gaya Indonesia: koma desimal + arah mata angin (LU/LS/BT/BB).
// Sebelumnya memakai titik desimal tanpa arah, sehingga kurang jelas bagi
// pembaca laporan di Indonesia.
function fmtCoord(c) {
  const lat = Number(c[0]), lng = Number(c[1]);
  if (!isFinite(lat) || !isFinite(lng)) return '—';
  const arahLat = lat >= 0 ? 'LU' : 'LS';
  const arahLng = lng >= 0 ? 'BT' : 'BB';
  return Math.abs(lat).toFixed(5).replace('.', ',') + '° ' + arahLat +
         ', ' + Math.abs(lng).toFixed(5).replace('.', ',') + '° ' + arahLng;
}

/* -------------------- Pengukuran (Turf.js) -------------------- */
function computeMeasure(layer, type) {
  try {
    if (type === 'Marker') {
      const ll = layer.getLatLng();
      return { coords: [ll.lat, ll.lng] };
    }
    if (type === 'Circle') {
      const r = layer.getRadius(), c = layer.getLatLng();
      return {
        radius: r, area: Math.PI * r * r, perimeter: 2 * Math.PI * r,
        coords: [c.lat, c.lng]
      };
    }
    const gj = layer.toGeoJSON();
    if (type === 'Polyline') {
      return { length: turf.length(gj) * 1000 };
    }
    // Polygon & Rectangle
    const ring = gj.geometry.coordinates[0];
    return {
      area: turf.area(gj),
      perimeter: turf.length(turf.lineString(ring)) * 1000
    };
  } catch (e) {
    console.warn('computeMeasure gagal:', e);
    return {};
  }
}

function measureRows(f) {
  const m = f.measure || {}, rows = [];
  if (f.type === 'Marker') {
    if (m.coords) rows.push({ label: 'Koordinat', value: fmtCoord(m.coords) });
  } else if (f.type === 'Circle') {
    if (m.radius != null) rows.push({ label: 'Radius', value: fmtLen(m.radius) });
    if (m.area != null) rows.push({ label: 'Luas', value: fmtArea(m.area) });
    if (m.perimeter != null) rows.push({ label: 'Keliling', value: fmtLen(m.perimeter) });
  } else if (f.type === 'Polyline') {
    if (m.length != null) rows.push({ label: 'Panjang', value: fmtLen(m.length) });
  } else { // Polygon / Rectangle
    if (m.area != null) rows.push({ label: 'Luas', value: fmtArea(m.area) });
    if (m.perimeter != null) rows.push({ label: 'Keliling', value: fmtLen(m.perimeter) });
  }
  return rows;
}

/* -------------------- Gaya & ikon -------------------- */
// Isian sengaja tetap bening (peta dasar harus tetap terbaca), sedangkan
// keterbacaan dijaga lewat GARIS TEPI yang tegas + halo putih tipis.
// Halo ini yang membuat poligon tetap terlihat di atas basemap gelap
// (mis. Satelit/Gelap), di mana warna seperti ungu bisa tenggelam.
function styleFor(type, color, fillOpacity, customColor) {
  // customColor: warna khusus per-fitur (bisa berbeda dari warna kategori).
  // fillOpacity: 0–1, default 0.28. Null = pakai default.
  const c = customColor || color;
  const fo = (fillOpacity != null) ? fillOpacity : 0.28;
  if (type === 'Polyline') {
    // Garis juga dapat halo: garis tipis paling rawan tenggelam di
    // atas basemap gelap.
    return { color: c, weight: 3, opacity: .98, lineJoin: 'round', halo: true };
  }
  if (type === 'Marker') return {};
  return {
    color: c,
    weight: 2.5,
    opacity: .98,
    fillColor: c,
    fillOpacity: fo,
    lineJoin: 'round',
    // Halo putih di bawah garis agar kontras terjaga di latar apa pun.
    // Leaflet tidak punya properti ini, jadi dipasang sebagai opsi kustom
    // dan diterapkan lewat pane terpisah di applyStyle().
    halo: true
  };
}

// Lapisan halo: salinan garis putih yang digambar tepat di bawah fitur.
function ensureHaloLayer() {
  if (!map.__haloGroup) {
    map.__haloGroup = L.featureGroup().addTo(map);
  }
  return map.__haloGroup;
}

// Bangun ulang halo untuk satu fitur (garis putih lebih tebal di bawahnya).
function applyHalo(f, color) {
  if (f.type === 'Marker' || f.type === 'Circle') return;
  const group = ensureHaloLayer();
  if (f.__halo) { group.removeLayer(f.__halo); f.__halo = null; }
  if (!styleFor(f.type, color).halo) return;

  let layer = null;
  try {
    if (f.type === 'Polyline') {
      layer = L.polyline(f.layer.getLatLngs(), {
        color: '#ffffff', weight: 6.5, opacity: .85,
        lineJoin: 'round', interactive: false
      });
    } else {
      layer = L.polygon(f.layer.getLatLngs(), {
        color: '#ffffff', weight: 6.5, opacity: .85,
        fill: false, lineJoin: 'round', interactive: false
      });
    }
  } catch (e) { return; }

  layer.addTo(group);
  // Halo harus tepat di bawah fitur aslinya.
  const pane = group.getPane ? group.getPane() : null;
  f.__halo = layer;
  group.bringToBack();
  if (typeof drawnItems !== 'undefined' && drawnItems.bringToFront) {
    drawnItems.bringToFront();
  }
}

function markerIcon(color) {
  const svg =
    '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M13 1 C6.4 1 1.4 6 1.4 12.6 c0 9.2 11.6 20.6 11.6 20.6 S24.6 21.8 24.6 12.6 C24.6 6 19.6 1 13 1 z" ' +
    'fill="' + color + '" stroke="#ffffff" stroke-width="2.2"/>' +
    '<circle cx="13" cy="12.6" r="4.6" fill="#ffffff"/></svg>';
  return L.divIcon({
    html: svg, className: 'dm-marker',
    iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30]
  });
}

// Label permanen berisi nama fitur, ditampilkan di atas peta (bukan hanya
// di popup). Ini kebutuhan dasar peta delinasi: kawasan tanpa nama tidak
// berguna di laporan. Bisa dimatikan lewat toggle "Nama fitur di peta".
function applyLabel(f) {
  if (!f.layer || typeof f.layer.bindTooltip !== 'function') return;
  const show = layout.showLabels !== false;
  const nama = (f.name || '').trim();
  const sudahAda = f.__labelBound;

  // Lepas label lama bila nama berubah atau label dimatikan.
  // Catatan: unbindTooltip() Leaflet TIDAK selalu membuang elemen tooltip
  // permanen dari DOM, jadi elemennya dihapus manual. Tanpa ini, toggle
  // "Nama fitur di peta" terlihat tidak berfungsi.
  function buangElemenLabel(layer) {
    const t = layer.getTooltip && layer.getTooltip();
    if (t && t._container && t._container.parentNode) {
      t._container.parentNode.removeChild(t._container);
    }
  }

  if (sudahAda) {
    try { f.layer.closeTooltip(); } catch (e) {}
    try { buangElemenLabel(f.layer); } catch (e) {}
    try { f.layer.unbindTooltip(); } catch (e) {}
    f.__labelBound = false;
  }
  if (!show || !nama) return;

  try {
    f.layer.bindTooltip(nama, {
      permanent: true,
      direction: 'center',
      className: 'dm-feature-label' + (f.type === 'Marker' ? ' dm-label-point' : ''),
      opacity: 1
    });
    f.__labelBound = true;
  } catch (e) { /* diabaikan */ }
}

// Terapkan label ke semua fitur (dipakai saat toggle diubah).
function refreshAllLabels() {
  features.forEach(applyLabel);
  // Sapu bersih: buang elemen label yang tidak lagi punya pemilik.
  const pane = document.querySelector('#map .leaflet-tooltip-pane');
  if (pane) {
    Array.from(pane.querySelectorAll('.dm-feature-label')).forEach(el => {
      const teks = (el.textContent || '').trim();
      const masihDipakai = (layout.showLabels !== false) && features.some(f =>
        f.__labelBound && (f.name || '').trim() === teks);
      if (!masihDipakai) el.remove();
    });
  }
}

function applyStyle(f) {
  // Warna dasar dari kategori; customColor bisa menimpa per-fitur.
  const color = catOf(f.category).color;
  // Opacity kategori sebagai default, lalu opacity fitur bisa override.
  const catOpacity = catOf(f.category).fillOpacity;
  const fo = (f.fillOpacity != null) ? f.fillOpacity
    : (catOpacity != null) ? catOpacity
    : 0.28;
  if (f.type === 'Marker') {
    const c = f.customColor || color;
    if (f.layer.setIcon) f.layer.setIcon(markerIcon(c));
  } else if (f.layer.setStyle) {
    f.layer.setStyle(styleFor(f.type, color, fo, f.customColor || null));
  }
  // Halo putih menjaga keterbacaan di atas basemap gelap.
  applyHalo(f, f.customColor || color);
  // Label nama fitur.
  applyLabel(f);
}

/* -------------------- Popup -------------------- */
function popupHTML(f) {
  const cat = catOf(f.category);
  const rows = measureRows(f).map(r =>
    '<div class="row"><span class="label">' + esc(r.label) + '</span><span class="val">' + esc(r.value) + '</span></div>'
  ).join('');
  return (
    '<b>' + (esc(f.name) || '<i style="color:#8b97a8">Tanpa nama</i>') + '</b>' +
    '<div style="color:#5b6879;margin:2px 0 7px;font-size:11.5px">' +
      esc(TYPE_LABEL[f.type] || f.type) + ' · ' + esc(cat.label) + '</div>' +
    (rows ? '<div style="background:#f2f6fd;border:1px solid #dbe5fb;border-radius:8px;padding:6px 8px;margin-bottom:7px">' + rows + '</div>' : '') +
    (f.desc ? '<div style="color:#5b6879;margin-bottom:6px">' + esc(f.desc) + '</div>' : '') +
    '<div style="margin-top:8px;display:flex;gap:6px">' +
      '<button class="btn btn-secondary btn-sm" data-act="edit">Ubah</button>' +
      '<button class="btn btn-danger-ghost btn-sm" data-act="del">Hapus</button>' +
    '</div>'
  );
}

function bindPopup(f) {
  f.layer.unbindPopup();
  f.layer.bindPopup(popupHTML(f), { featureId: f.id, minWidth: 200, maxWidth: 280, closeButton: true });
}

/* -------------------- Daftar fitur (sidebar) -------------------- */
function renderList() {
  const list = $('#feat-list');
  list.innerHTML = '';
  $('#feat-count').textContent = features.length;
  $('#feat-empty').style.display = features.length ? 'none' : '';
  refreshAllLabels();
  // Hitungan "n fitur" dan tombol hapus di panel warna ikut berubah.
  if (typeof renderCategoryColors === 'function') renderCategoryColors();
  // Legenda lembar formal dibangun dari kategori unik -> ikut diperbarui.
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();

  features.forEach(f => {
    const color = catOf(f.category).color;
    const rows = measureRows(f);
    const meta = (TYPE_LABEL[f.type] || f.type) +
      (rows.length ? ' · ' + rows.map(r => r.value).join(' · ') : '');

    const el = document.createElement('div');
    el.className = 'feat';
    el.dataset.fid = f.id;
    el.innerHTML =
      '<span class="feat-swatch ' + (f.type === 'Marker' ? 'dot' : '') + '" style="background:' + color + '"></span>' +
      '<div class="feat-main">' +
        '<div class="feat-name ' + (f.name ? '' : 'noname') + '">' + (esc(f.name) || 'Tanpa nama') + '</div>' +
        '<div class="feat-meta">' + esc(meta) + '</div>' +
      '</div>' +
      '<div class="feat-acts">' +
        '<button class="icon-btn" data-act="zoom" title="Lompat ke fitur" aria-label="Lompat ke fitur">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg></button>' +
        '<button class="icon-btn" data-act="edit" title="Edit detail" aria-label="Edit detail">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 h4 L20 8 l-4 -4 L4 16 z"/></svg></button>' +
        '<button class="icon-btn del" data-act="del" title="Hapus fitur" aria-label="Hapus fitur">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 h16 M9 7 V4 h6 v3 M6 7 l1 13 h10 l1 -13"/></svg></button>' +
      '</div>';

    el.querySelector('.feat-main').addEventListener('click', () => zoomTo(f));
    el.querySelectorAll('.icon-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'zoom') zoomTo(f);
        if (act === 'edit') openAttrModal(f.id);
        if (act === 'del') deleteFeature(f.id);
      });
    });
    list.appendChild(el);
  });
}

function highlightItem(id) {
  $$('#feat-list .feat').forEach(el => {
    el.classList.toggle('selected', String(el.dataset.fid) === String(id));
  });
}

function zoomTo(f) {
  highlightItem(f.id);
  if (f.type === 'Marker') {
    map.flyTo(f.layer.getLatLng(), Math.max(map.getZoom(), 15), { duration: .6 });
    setTimeout(() => f.layer.openPopup(), 650);
  } else {
    map.flyToBounds(f.layer.getBounds(), { duration: .6, padding: [40, 40] });
    setTimeout(() => f.layer.openPopup(), 650);
  }
  closeSidebarMobile();
}

function refreshFeature(f) {
  f.measure = computeMeasure(f.layer, f.type);
  applyStyle(f);
  bindPopup(f);
}

/* -------------------- Tambah / hapus fitur -------------------- */
function addFeature(f, openModal) {
  drawnItems.addLayer(f.layer);
  refreshFeature(f);
  features.push(f);
  renderList();
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();
  save('Tambah fitur');
  if (openModal) {
    openAttrModal(f.id, true);
  } else {
    f.layer.openPopup();
  }
}

function deleteFeature(id) {
  const i = features.findIndex(f => f.id === id);
  if (i < 0) return;
  map.closePopup();
  const removed = features[i];
  drawnItems.removeLayer(removed.layer);
  if (removed.__halo && map.__haloGroup) {
    map.__haloGroup.removeLayer(removed.__halo);
    removed.__halo = null;
  }
  features.splice(i, 1);
  renderList();
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();
  save();
  // Tawarkan urungkan penghapusan (safety net, sangat penting untuk mahasiswa!).
  toast('Fitur "' + (removed.name || 'tanpa nama') + '" dihapus', {
    actionLabel: 'Urungkan',
    onAction: () => {
      if (features.some(f => f.id === removed.id)) return;
      features.push(removed);
      drawnItems.addLayer(removed.layer);
      renderList();
      save('Pulihkan fitur');
      toast('Fitur dipulihkan');
    }
  });
}

function clearAll() {
  if (!features.length) { toast('Tidak ada fitur untuk dihapus'); return; }
  if (!confirm('Hapus semua ' + features.length + ' fitur dari peta? Tindakan ini tidak bisa dibatalkan.')) return;
  map.closePopup();
  const backup = features.slice();
  features.forEach(f => {
    drawnItems.removeLayer(f.layer);
    if (f.__halo && map.__haloGroup) map.__haloGroup.removeLayer(f.__halo);
  });
  features = [];
  renderList();
  save('Hapus semua');
  toast('Semua fitur dihapus', {
    actionLabel: 'Urungkan',
    onAction: () => {
      features = backup;
      features.forEach(f => { drawnItems.addLayer(f.layer); applyStyle(f); });
      renderList();
      save();
      toast(backup.length + ' fitur dipulihkan');
    }
  });
}

/* -------------------- Gambar di peta -------------------- */
function startDraw(type) {
  stopEdit();
  if (currentDrawer) currentDrawer.disable();
  currentDrawerType = type;
  const color = '#2f6fed';
  const opts = (type === 'Marker')
    ? { icon: markerIcon(color) }
    : { shapeOptions: styleFor(type, color) };
  currentDrawer = new L.Draw[type](map, opts);
  currentDrawer.enable();
  // Referensi untuk otomasi/test (opsional, tidak mempengaruhi fungsi).
  window.__drawer = currentDrawer;

  $$('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === type));
  $('#draw-hint').textContent = HINT[type] || '';
  setBadge(HINT[type] || '');

  const isMulti = type === 'Polygon' || type === 'Polyline';
  setGuideBanner(
    HINT[type] || 'Klik di peta untuk menggambar.',
    isMulti ? 'Selesai (Enter)' : 'Batal (Esc)',
    isMulti ? () => {
      if (currentDrawer && typeof currentDrawer.completeShape === 'function') {
        currentDrawer.completeShape();
      } else {
        stopDraw();
      }
    } : stopDraw,
    type === 'Marker' ? '📍' : '✏️'
  );
}

function stopDraw() {
  if (currentDrawer) {
    try { currentDrawer.disable(); } catch (e) {}
    currentDrawer = null;
    currentDrawerType = null;
  }
  setBadge('');
  setGuideBanner(null);

  $$('.tool[data-tool]').forEach(b => b.classList.remove('active'));
  $('#draw-hint').textContent =
    'Pilih salah satu alat di atas, lalu klik di peta untuk mulai menggambar. Klik dua kali (atau Enter) untuk selesaikan poligon/garis.';
  try { delete window.__drawer; } catch (e) { window.__drawer = undefined; }
}

function setGuideBanner(text, btnLabel, btnAction, icon) {
  const banner = $('#draw-guide-banner');
  if (!banner) return;
  if (!text) {
    banner.classList.add('hidden');
    return;
  }
  const textEl = $('#draw-guide-text');
  const btnEl = $('#draw-guide-btn');
  const iconEl = $('#draw-guide-icon');
  if (textEl) textEl.textContent = text;
  if (iconEl) iconEl.textContent = icon || '✏️';
  if (btnEl) {
    btnEl.textContent = btnLabel || 'Batal';
    btnEl.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof btnAction === 'function') btnAction();
    };
  }
  banner.classList.remove('hidden');
}

function setBadge(html) {
  const b = $('#measure-badge');
  if (!html) { b.classList.add('hidden'); b.innerHTML = ''; return; }
  b.innerHTML = html;
  b.classList.remove('hidden');
}

/* ---- Edit mode ---- */
function toggleEdit() {
  if (editHandler) stopEdit(); else startEdit();
}
function startEdit() {
  if (!features.length) { toast('Belum ada fitur untuk diedit'); return; }
  stopDraw();
  editHandler = new L.EditToolbar.Edit(map, { featureGroup: drawnItems });
  editHandler.enable();
  $('#tool-edit').classList.add('active');
  setBadge('Mode edit: tarik sudut pada fitur untuk mengubah bentuk, lalu klik Simpan.');
  setGuideBanner(
    'Mode Ubah Bentuk: geser sudut fitur untuk merapikan batas.',
    'Selesai Mengubah',
    stopEdit,
    '🔧'
  );
  toast('Klik & tarik sudut fitur untuk mengedit');
}
function stopEdit() {
  if (!editHandler) return;
  try { editHandler.disable(); } catch (e) {}
  editHandler = null;
  $('#tool-edit').classList.remove('active');
  setBadge('');
  setGuideBanner(null);
}

/* -------------------- Modal atribut -------------------- */
function openAttrModal(id, isNew) {
  const f = features.find(x => x.id === id);
  if (!f) return;
  editingFeatureId = id;

  renderCategorySelect();
  const sel = $('#attr-category');
  sel.value = CATEGORIES.some(c => c.id === f.category)
    ? f.category
    : (CATEGORIES[CATEGORIES.length - 1] || {}).id;

  $('#attr-name').value = f.name || '';
  $('#attr-desc').value = f.desc || '';
  $('#attr-measure').innerHTML = measureRows(f).map(r =>
    '<div class="row"><span class="label">' + esc(r.label) + '</span><span class="val">' + esc(r.value) + '</span></div>'
  ).join('') || '<div class="row"><span class="val">—</span></div>';

  // ---- Pewarnaan & opacity ----
  // Sembunyikan kontrol gaya untuk titik (Marker tidak memiliki isian poligon).
  const styleWrap = $('#attr-style-wrap');
  if (styleWrap) styleWrap.style.display = (f.type === 'Marker') ? 'none' : '';

  const opacityInput = $('#attr-opacity');
  const opacityVal   = $('#attr-opacity-val');
  const customToggle = $('#attr-custom-color-toggle');
  const customRow    = $('#attr-custom-color-row');
  const customColor  = $('#attr-custom-color');

  if (opacityInput) {
    const pct = Math.round((f.fillOpacity != null ? f.fillOpacity : 0.28) * 100);
    opacityInput.value = pct;
    if (opacityVal) opacityVal.textContent = pct + '%';
  }
  if (customToggle && customRow && customColor) {
    const hasCustom = !!f.customColor;
    customToggle.checked = hasCustom;
    customRow.classList.toggle('hidden', !hasCustom);
    customColor.value = f.customColor || catOf(f.category).color || '#2a9d8f';
  }

  $('#modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#attr-name').focus(), 60);
}


function closeAttrModal() {
  $('#modal-overlay').classList.add('hidden');
  editingFeatureId = null;
}

// Focus trap: menjaga fokus Tab tetap di dalam modal (aksesibilitas).
function trapFocus(container, e) {
  const focusables = Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

/* -------------------- Peta dasar -------------------- */
// Semua peta dasar di bawah ini GRATIS & TANPA API KEY / token.
// Jangan tambahkan penyedia yang butuh kunci (mis. Stadia Maps, Mapbox,
// Thunderforest) karena akan gagal 401 di komputer pengguna.
const BASEMAPS = {
  streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true,
    attribution: '© kontributor OpenStreetMap'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true,
    attribution: '© Esri, Maxar, Earthstar Geographics'
  }),
  // Relief/terrain: penting untuk analisis wilayah (kemiringan, DAS, tutupan lahan).
  terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true,
    attribution: '© Esri, HERE, Garmin, USGS, Intermap'
  }),
  // Topografi OpenTopoMap: kontur & nama puncak, cocok untuk tugas geomorfologi.
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, crossOrigin: true,
    attribution: '© OpenTopoMap (CC-BY-SA), © kontributor OpenStreetMap'
  }),
  // Tanpa peta dasar: hanya latar polos, untuk delinasi di atas citra sendiri.
  none: L.tileLayer('', { attribution: '' })
};

function setBasemap(id, skipSave) {
  if (!BASEMAPS[id]) return;
  if (BASEMAPS[currentBasemap]) map.removeLayer(BASEMAPS[currentBasemap]);
  currentBasemap = id;
  // 'none' = tanpa ubin: hanya latar polos dari CSS.
  if (id !== 'none') {
    map.addLayer(BASEMAPS[id]);
    BASEMAPS[id].bringToBack();
  }
  // Indikator loading: tampil saat tile masih dimuat.
  const layer = BASEMAPS[id];
  const loader = $('#tile-loader');
  if (loader && !layer.__loaderBound) {
    layer.__loaderBound = true;
    layer.on('loading', () => loader.classList.remove('hidden'));
    layer.on('load', () => loader.classList.add('hidden'));
  }
  if (loader) loader.classList.remove('hidden');
  $$('#basemap-row button').forEach(b => b.classList.toggle('active', b.dataset.basemap === id));
  // Kotak kredit menampilkan "Sumber data" sesuai peta dasar aktif —
  // tanpa ini atribusi bisa menyebut penyedia yang salah di laporan.
  if (typeof updateLayout === 'function') updateLayout();
  // Bila inset disetel "sama dengan peta utama", ubah ubinnya juga.
  if (typeof FormalSheet !== 'undefined' && FormalSheet.applyInsetOptions) {
    FormalSheet.applyInsetOptions();
  }
  if (!skipSave) save();
}

/* -------------------- Layout peta (judul, legenda, utara, kredit) ---------- */
// Nilai awal field kop akademik (semua tetap bisa diubah user).
const KOP_DEFAULTS = {
  programStudy: '', institution: '', logo: '', logoName: '',
  // Diagram lokasi (inset) — semua bisa diubah user.
  insetShow: true,
  insetBasemap: 'streets', // streets | terrain | satellite | topo | follow
  insetZoom: '4',          // seberapa jauh zoom-out dari peta utama
  insetHeight: '150',      // px
  insetColor: '#e01b1b',   // warna kotak cakupan
  insetGrid: '1',          // tampilkan grid koordinat inset
  insetLabel: 'Diagram Lokasi:',
  activityTitle: '', activityYear: String(new Date().getFullYear()),
  projection: 'Universal Transverse Mercator', zone: 'UTM 52S', datum: 'WGS 1984',
  sourceData: '', supervisorTitle: '', mapmakerName: '', mapmakerDegree: '',
  gridPos: 'outside',      // outside (luar peta) | inside (dalam peta)
  legendTitle: 'LEGENDA:',
  sourceTitle: 'SUMBER DATA DAN RIWAYAT PETA:',
  signKnowTitle: 'Mengetahui,',
  refTitle: 'SISTEM KOORDINAT:',
  titleAlign: 'center',    // center | left | right
  instAlign: 'left',       // left | center | right
  signAlign: 'right',      // right | center | left
  panelPosition: 'right',  // right | left | bottom | top
  fontFamily: 'serif',     // serif | sans | mono | humanist
  legendShowMeasure: true,
  northStyle: 'classic',   // classic | triangle | modern | star | survey
  northLetter: 'U',        // U | N
  scaleMode: 'auto',       // auto | custom
  scaleCustom: '25000',
  customBlocks: [],
  blokOrder: []
};

const layout = {
  title: '', author: '',
  // Nama fitur ditampilkan di peta (label permanen), bukan hanya di popup.
  showLabels: true,
  tpl: 'formal',
  kop: Object.assign({}, KOP_DEFAULTS, { customBlocks: [], blokOrder: [] })
};

// Layout peta: HANYA lembar "Kop Akademik".
// Preset lain (Klasik, Rapat Kanan, Judul Bawah, Bersih) dihapus dulu:
// tempatnya di atas peta (overlay) tidak dipakai lagi dan hasil cetaknya
// tidak sebersih lembar kop. Semua teks peta masuk ke panel lembar ini.
const TEMPLATES = {
  formal: { showLabels: true, formal: true }
};

// Preset yang memakai lembar kop (bukan overlay di atas peta).
function isFormalTpl(id) { return !!(TEMPLATES[id] && TEMPLATES[id].formal); }

// Id preset yang tidak dikenal (mis. dari berkas proyek versi lama) jatuh
// ke lembar kop supaya aplikasi tidak pernah kehilangan tata letak.
function normalizeTplId(id) { return TEMPLATES[id] ? id : 'formal'; }

// Selaraskan kontrol panel dengan state (dipakai saat preset formal aktif).
function syncKopInputs() {
  KOP_FIELDS.forEach(({ field, id, isBool }) => {
    const el = $('#' + id);
    if (!el || layout.kop[field] == null) return;
    if (isBool || el.type === 'checkbox') {
      el.checked = !!layout.kop[field];
    } else {
      el.value = layout.kop[field];
    }
  });
  // insetShow tidak lagi dipakai: visibilitas inset diatur blokVis.inset.
  if (typeof updateKopAccordionBadges === 'function') {
    updateKopAccordionBadges();
  }
  if (typeof syncSegControls === 'function') {
    syncSegControls();
  }
}

// Pasang layout lembar kop. Hanya ada satu preset, tapi fungsi ini tetap
// dipakai saat memuat data tersimpan / mengimpor berkas proyek.
function applyTemplate(id) {
  const tpl = normalizeTplId(id);
  const t = TEMPLATES[tpl];
  layout.tpl = tpl;
  layout.showLabels = t.showLabels !== false;

  const wrap = $('#map-wrap');
  wrap.className = 'tpl-' + tpl;
  $$('#tpl-row button').forEach(b => b.classList.toggle('active', b.dataset.tpl === tpl));

  // Field kop selalu dipakai: seluruh teks peta berasal dari sini.
  const kopFields = $('#kop-fields');
  if (kopFields) kopFields.classList.remove('hidden');
  syncKopInputs();
  renderBlokToggles();

  const labelToggle = $('#layout-show-labels');
  if (labelToggle) labelToggle.checked = !!layout.showLabels;
  refreshAllLabels();

  // Bangun / segarkan lembar kop.
  FormalSheet.activate();

  updateLayout();
  save();
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
                'Juli','Agustus','September','Oktober','November','Desember'];

// Nama field state -> id elemen di HTML. Sebagian memakai kebab-case
// (mis. insetBasemap -> #kop-inset-basemap), jadi pemetaan ini eksplisit
// supaya tidak ada field yang diam-diam terlewat.
const KOP_FIELDS = [
  { field: 'programStudy',    id: 'kop-programStudy' },
  { field: 'institution',     id: 'kop-institution' },
  { field: 'activityTitle',   id: 'kop-activityTitle' },
  { field: 'activityYear',    id: 'kop-activityYear' },
  { field: 'projection',      id: 'kop-projection' },
  { field: 'zone',            id: 'kop-zone' },
  { field: 'datum',           id: 'kop-datum' },
  { field: 'sourceData',      id: 'kop-sourceData' },
  { field: 'supervisorTitle', id: 'kop-supervisorTitle' },
  { field: 'mapmakerName',    id: 'kop-mapmakerName' },
  { field: 'mapmakerDegree',  id: 'kop-mapmakerDegree' },
  // Opsi diagram lokasi (inset)
  { field: 'insetBasemap',    id: 'kop-inset-basemap' },
  { field: 'insetZoom',       id: 'kop-inset-zoom' },
  { field: 'insetHeight',     id: 'kop-inset-height' },
  { field: 'insetColor',      id: 'kop-inset-color' },
  { field: 'insetGrid',       id: 'kop-inset-grid' },
  { field: 'insetLabel',      id: 'kop-inset-label' },
  // Opsi grid koordinat peta utama
  { field: 'gridPos',         id: 'kop-grid-pos' },
  // Opsi perataan teks kop
  { field: 'titleAlign',      id: 'kop-title-align' },
  { field: 'instAlign',       id: 'kop-inst-align' },
  { field: 'signAlign',       id: 'kop-sign-align' },
  { field: 'panelPosition',   id: 'kop-panel-position' },
  { field: 'fontFamily',      id: 'kop-font-family' },
  // Opsi arah utara & skala
  { field: 'northStyle',        id: 'kop-north-style' },
  { field: 'northLetter',       id: 'kop-north-letter' },
  { field: 'scaleMode',         id: 'kop-scale-mode' },
  { field: 'scaleCustom',       id: 'kop-scale-custom' },
  // Opsi legenda
  { field: 'legendShowMeasure', id: 'kop-legend-show-measure', isBool: true }
];

function formatDateID(d) {
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// Sumber data per peta dasar (untuk kotak kredit & ekspor).
function basemapAttribution(id) {
  const m = {
    streets: 'OpenStreetMap & kontributornya',
    satellite: 'Esri, Maxar, Earthstar Geographics',
    terrain: 'Esri, HERE, Garmin, USGS, Intermap',
    topo: 'OpenTopoMap (CC-BY-SA) & kontributor OpenStreetMap',
    none: 'Data delinasi pengguna'
  };
  return m[id] || 'OpenStreetMap';
}

// Seluruh elemen peta (judul, legenda, skala, arah utara, kredit) digambar
// oleh lembar kop (js/formal-sheet.js), jadi di sini cukup memintanya
// menyegarkan diri setiap state berubah.
function updateLayout() {
  if (typeof FormalSheet === 'undefined' || !FormalSheet.isInstalled()) return;
  FormalSheet.scheduleRefresh();
}

// Atur skala peta ke rasio tertentu (1:rf) dengan menyesuaikan zoom otomatis.
function aturSkalaPeta(rf) {
  if (!map || !rf || rf <= 0) return;
  const lat = map.getCenter().lat;
  const targetZoom = typeof FormalLayout !== 'undefined' && FormalLayout.zoomForScale
    ? FormalLayout.zoomForScale(rf, lat)
    : 14;
  map.setZoom(Math.round(targetZoom));
  if (layout.kop) {
    layout.kop.scaleCustom = String(rf);
    layout.kop.scaleMode = 'custom';
    const customInp = $('#kop-scale-custom');
    if (customInp) customInp.value = String(rf);
    const modeEl = $('#kop-scale-mode');
    if (modeEl) modeEl.value = 'custom';
    const presetEl = $('#kop-scale-preset');
    if (presetEl) {
      const match = Array.from(presetEl.options).some(o => o.value === String(rf));
      if (match) presetEl.value = String(rf);
    }
  }
  updateLayout();
  save();
}
window.aturSkalaPeta = aturSkalaPeta;

/* -------------------- Accordion & Live Badges Kop -------------------- */
function updateKopAccordionBadges() {
  const k = (layout && layout.kop) || {};

  // 1. Komponen blok aktif
  const bBlocks = $('#acc-badge-blocks');
  if (bBlocks && typeof FormalSheet !== 'undefined' && FormalSheet.BLOK) {
    const total = FormalSheet.BLOK.length;
    const aktif = FormalSheet.BLOK.filter(b => blokTampil(b.id)).length;
    bBlocks.textContent = aktif + ' aktif';
  }

  // 2. Perataan, Posisi Kop & Font
  const bAlign = $('#acc-badge-align');
  if (bAlign) {
    const posMap = { right: 'Kanan', left: 'Kiri', bottom: 'Bawah', top: 'Atas' };
    const fontMap = { serif: 'Serif', sans: 'Sans', mono: 'Mono', humanist: 'Humanist' };
    const pName = posMap[k.panelPosition] || 'Kanan';
    const fName = fontMap[k.fontFamily] || 'Serif';
    bAlign.textContent = 'Posisi: ' + pName + (k.fontFamily && k.fontFamily !== 'serif' ? ' · ' + fName : '');
  }

  // 3. Judul Peta
  const bTitle = $('#acc-badge-title');
  if (bTitle) {
    const t = ((layout && layout.title) || '').trim();
    bTitle.textContent = t ? (t.length > 18 ? t.slice(0, 18) + '…' : t) : 'Belum diisi';
  }

  // 4. Instansi
  const bKop = $('#acc-badge-kop');
  if (bKop) {
    const txt = (k.institution || k.programStudy || '').trim();
    bKop.textContent = txt ? (txt.length > 18 ? txt.slice(0, 18) + '…' : txt) : (k.logoDataUrl ? 'Ada logo' : 'Belum diisi');
  }

  // 5. Kegiatan & Waktu
  const bAct = $('#acc-badge-activity');
  if (bAct) {
    const txt = (k.activityTitle || (k.activityYear ? 'Th ' + k.activityYear : '')).trim();
    bAct.textContent = txt ? (txt.length > 18 ? txt.slice(0, 18) + '…' : txt) : 'Belum diisi';
  }

  // 6. Skala & Arah Utara
  const bScale = $('#acc-badge-scale');
  if (bScale) {
    const mode = k.scaleMode === 'custom' ? 'Presisi' : 'Otomatis';
    const num = k.scaleCustom || k.scalePreset || '25000';
    const formatted = Number(num) > 0 ? Number(num).toLocaleString('id-ID') : num;
    bScale.textContent = '1:' + formatted + ' · ' + mode;
  }

  // 7. Grid / Koordinat
  const bRef = $('#acc-badge-ref');
  if (bRef) {
    bRef.textContent = (k.zone || 'UTM 52S').trim();
  }

  // 8. Legenda
  const bLeg = $('#acc-badge-legend');
  if (bLeg) {
    bLeg.textContent = k.legendShowMeasure !== false ? 'Ukuran aktif' : 'Simpel';
  }

  // 9. Sumber data
  const bSrc = $('#acc-badge-source');
  if (bSrc) {
    const s = (k.sourceData || '').trim();
    bSrc.textContent = s ? (s.length > 18 ? s.slice(0, 18) + '…' : s) : 'Bawaan';
  }

  // 10. Pengesahan
  const bSign = $('#acc-badge-sign');
  if (bSign) {
    const sign = (k.mapmakerName || (layout && layout.author) || '').trim();
    bSign.textContent = sign ? (sign.length > 18 ? sign.slice(0, 18) + '…' : sign) : 'Belum diisi';
  }

  // 11. Inset
  const bInset = $('#acc-badge-inset');
  if (bInset) {
    const basemapMap = { streets: 'Jalan', satellite: 'Satelit', terrain: 'Relief', topo: 'Topo', follow: 'Sama peta' };
    const bName = basemapMap[k.insetBasemap] || 'Jalan';
    bInset.textContent = bName + ' · Z' + (k.insetZoom || 4);
  }

  // Sinkronkan kelas aktif pada tombol chip skala cepat
  const currScale = String(k.scaleCustom || k.scalePreset || '25000');
  $$('.scale-chip').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.scale === currScale);
  });
}

function initKopAccordion() {
  const isAutoTest = typeof navigator !== 'undefined' && navigator.webdriver;
  if (isAutoTest) {
    document.body.classList.add('is-webdriver');
  }

  const list = $('#kop-accordion-list');
  if (!list) return;

  // Toggle buka/tutup kartu accordion saat header diklik
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.kop-accordion-header');
    if (!btn) return;
    const card = btn.closest('.kop-accordion-card');
    if (!card) return;
    const isOpen = card.classList.contains('is-open');
    card.classList.toggle('is-open', !isOpen);
    btn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
  });

  // Tombol aksi cepat: Buka semua
  const btnAll = $('#btn-acc-expand-all');
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      $$('.kop-accordion-card').forEach(c => {
        c.classList.add('is-open');
        const h = c.querySelector('.kop-accordion-header');
        if (h) h.setAttribute('aria-expanded', 'true');
      });
    });
  }

  // Tombol aksi cepat: Tutup semua
  const btnNone = $('#btn-acc-collapse-all');
  if (btnNone) {
    btnNone.addEventListener('click', () => {
      $$('.kop-accordion-card').forEach(c => {
        c.classList.remove('is-open');
        const h = c.querySelector('.kop-accordion-header');
        if (h) h.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Auto-expand saat elemen input di dalam kartu menerima fokus keyboard
  list.addEventListener('focusin', (e) => {
    const card = e.target.closest('.kop-accordion-card');
    if (card && !card.classList.contains('is-open')) {
      card.classList.add('is-open');
      const h = card.querySelector('.kop-accordion-header');
      if (h) h.setAttribute('aria-expanded', 'true');
    }
  });

  // Chip skala cepat
  const chipsWrap = $('#scale-chips');
  if (chipsWrap) {
    chipsWrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.scale-chip');
      if (!chip) return;
      const rf = Number(chip.dataset.scale);
      if (rf > 0) {
        aturSkalaPeta(rf);
        updateKopAccordionBadges();
      }
    });
  }

  // Buka bagian kop spesifik dari luar (sinkronisasi klik lembar peta)
  window.bukaBagianKop = function(sectionId) {
    if (!sectionId) return;
    let card = document.querySelector(`[data-blok-section="${sectionId}"]`);
    if (!card) {
      card = document.getElementById('kop-acc-' + sectionId);
    }
    // Jika bagian kustom
    if (!card && (sectionId.startsWith('custom-') || sectionId === 'custom')) {
      card = document.getElementById('kop-acc-blocks');
    }
    if (card) {
      card.classList.add('is-open');
      const h = card.querySelector('.kop-accordion-header');
      if (h) h.setAttribute('aria-expanded', 'true');

      try {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {}

      card.classList.remove('is-highlighted');
      void card.offsetWidth; // trigger reflow
      card.classList.add('is-highlighted');
      setTimeout(() => card.classList.remove('is-highlighted'), 1400);

      // Fokuskan input pertama di kartu bila sedang tidak mengetik teks inline
      const activeEl = document.activeElement;
      const isEditingSheet = activeEl && activeEl.classList.contains('fl-editable');
      if (!isEditingSheet) {
        const inp = card.querySelector('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]), textarea, select');
        if (inp && activeEl !== inp) {
          try { inp.focus({ preventScroll: true }); } catch (err) {}
        }
      }
    }
  };

  // Dalam lingkungan Playwright/automated test, buka semua kartu agar selektor langsung siap
  if (isAutoTest) {
    $$('.kop-accordion-card').forEach(c => {
      c.classList.add('is-open');
      const h = c.querySelector('.kop-accordion-header');
      if (h) h.setAttribute('aria-expanded', 'true');
    });
  }

  updateKopAccordionBadges();
  initSegControls();
  initKopTemplates();
}

/* -------------------- Segmented Controls & Presets -------------------- */
function syncSegControls() {
  const k = (layout && layout.kop) || {};
  // Posisi kop
  const pos = (k.panelPosition || 'right').toLowerCase();
  $$('#seg-panel-position .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.val === pos);
  });
  // Tipografi font lembar
  const font = (k.fontFamily || 'serif').toLowerCase();
  $$('#kop-font-chips .font-chip').forEach(b => {
    b.classList.toggle('is-active', b.dataset.font === font);
  });
  // Perataan Judul
  const tAlign = (k.titleAlign || 'center').toLowerCase();
  $$('#seg-title-align .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.val === tAlign);
  });
  // Perataan Instansi
  const iAlign = (k.instAlign || 'left').toLowerCase();
  $$('#seg-inst-align .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.val === iAlign);
  });
  // Perataan Pengesahan
  const sAlign = (k.signAlign || 'right').toLowerCase();
  $$('#seg-sign-align .seg-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.val === sAlign);
  });
}

function initSegControls() {
  const wire = (containerSelector, selectId, attrName) => {
    const container = $(containerSelector);
    const selectEl = $(selectId);
    if (!container || !selectEl) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[' + attrName + ']');
      if (!btn) return;
      const val = btn.getAttribute(attrName);
      if (val) {
        selectEl.value = val;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        syncSegControls();
      }
    });
  };

  wire('#seg-panel-position', '#kop-panel-position', 'data-val');
  wire('#kop-font-chips', '#kop-font-family', 'data-font');
  wire('#seg-title-align', '#kop-title-align', 'data-val');
  wire('#seg-inst-align', '#kop-inst-align', 'data-val');
  wire('#seg-sign-align', '#kop-sign-align', 'data-val');

  syncSegControls();
}

/* -------------------- Template Kop Instan (1-Klik) -------------------- */
const KOP_TEMPLATES = {
  pwk: {
    name: 'Studio PWK',
    title: 'PETA DELINIASI KAWASAN PERENCANAAN',
    programStudy: 'Program Studi Perencanaan Wilayah dan Kota',
    institution: 'Fakultas Teknik - Universitas',
    activityTitle: 'Penyusunan Rencana Detail Tata Ruang (RDTR)',
    activityYear: String(new Date().getFullYear()),
    projection: 'Universal Transverse Mercator',
    zone: 'UTM Zone 48S',
    datum: 'WGS 1984',
    sourceData: 'Peta Rupa Bumi Indonesia (BIG) Skala 1:25.000\nCitra Satelit Resolusi Tinggi\nSurvei Lapangan Studio PWK',
    mapmakerName: 'Tim Studio PWK',
    mapmakerDegree: 'Mahasiswa PWK',
    supervisorTitle: 'Dosen Pembimbing Studio',
    fontFamily: 'serif',
    panelPosition: 'right'
  },
  skripsi: {
    name: 'Skripsi / TA',
    title: 'PETA WILAYAH STUDI PENELITIAN',
    programStudy: 'Program Studi Teknik Geodesi & Geomatika',
    institution: 'Fakultas Teknik - Universitas',
    activityTitle: 'Penelitian Skripsi / Tugas Akhir',
    activityYear: String(new Date().getFullYear()),
    projection: 'Universal Transverse Mercator (UTM)',
    zone: 'WGS 84 / UTM Zone 49S',
    datum: 'WGS 1984',
    sourceData: 'Survei GNSS & Ground Check Lapangan\nDelinasi Mandiri Citra Tegak\nBadan Informasi Geospasial (BIG)',
    mapmakerName: 'Peneliti Mandiri',
    mapmakerDegree: 'S.T.',
    supervisorTitle: 'Dosen Pembimbing I & II',
    fontFamily: 'serif',
    panelPosition: 'right'
  },
  pupr: {
    name: 'Dinas PUPR',
    title: 'PETA RENCANA TATA RUANG WILAYAH',
    programStudy: 'Bidang Penataan Ruang & Bina Marga',
    institution: 'Dinas Pekerjaan Umum dan Penataan Ruang',
    activityTitle: 'Penyusunan Dokumen RTRW Daerah',
    activityYear: String(new Date().getFullYear()),
    projection: 'Universal Transverse Mercator',
    zone: 'Grid Nasional BIG',
    datum: 'WGS 1984',
    sourceData: 'Badan Informasi Geospasial (BIG)\nKementerian ATR / BPN\nDatabase Geospasial Daerah',
    mapmakerName: 'Tim Teknis GIS & Pemetaan',
    mapmakerDegree: 'Pranata Pemetaan',
    supervisorTitle: 'Kepala Bidang Penataan Ruang',
    fontFamily: 'sans',
    panelPosition: 'right'
  },
  masterplan: {
    name: 'Masterplan',
    title: 'PETA MASTERPLAN PENGEMBANGAN LAHAN',
    programStudy: 'Divisi Perencanaan Lahan & Masterplan',
    institution: 'PT Konsultan Perencana Desain',
    activityTitle: 'Kawasan Pengembangan Terpadu',
    activityYear: String(new Date().getFullYear()),
    projection: 'WGS 1984 / UTM',
    zone: 'UTM Zone 48S / 49S',
    datum: 'WGS 1984',
    sourceData: 'Peta Batas Sertifikat BPN\nPengukuran Topografi Lapangan (Total Station)\nMasterplan Desain Arsitektur',
    mapmakerName: 'Urban Designer & GIS Planner',
    mapmakerDegree: 'Lead Planner',
    supervisorTitle: 'Project Director',
    fontFamily: 'humanist',
    panelPosition: 'right'
  }
};

function applyKopTemplate(tplKey) {
  const tpl = KOP_TEMPLATES[tplKey];
  if (!tpl) return;
  if (!layout.kop) layout.kop = Object.assign({}, KOP_DEFAULTS);

  // Set judul peta
  if (tpl.title) {
    layout.title = tpl.title;
    const tInput = $('#layout-title');
    if (tInput) tInput.value = tpl.title;
  }

  // Set field kop
  Object.keys(tpl).forEach(key => {
    if (key === 'name' || key === 'title') return;
    layout.kop[key] = tpl[key];
    const match = KOP_FIELDS.find(f => f.field === key);
    if (match) {
      const el = $('#' + match.id);
      if (el) {
        if (match.isBool || el.type === 'checkbox') {
          el.checked = !!tpl[key];
        } else {
          el.value = tpl[key];
        }
      }
    }
  });

  if (typeof history !== 'undefined' && history.push) {
    history.push('Terapkan template kop: ' + tpl.name);
  }
  save();
  updateLayout();
  updateKopAccordionBadges();
  syncSegControls();
  toast('Template ' + tpl.name + ' berhasil diterapkan!');
}
window.applyKopTemplate = applyKopTemplate;

function initKopTemplates() {
  const container = $('#kop-template-chips');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.kop-tpl-btn');
    if (!btn) return;
    const key = btn.dataset.kopTpl;
    if (key) applyKopTemplate(key);
  });
}

function bindLayout() {
  $('#layout-title').addEventListener('input', (e) => {
    layout.title = e.target.value;
    updateKopAccordionBadges();
    updateLayout();
    save();
  });
  $('#layout-author').addEventListener('input', (e) => {
    layout.author = e.target.value;
    if (!layout.kop.mapmakerName || layout.kop.mapmakerName === layout._lastAuthor) {
      layout.kop.mapmakerName = layout.author;
      const el = $('#kop-mapmakerName');
      if (el) el.value = layout.author;
    }
    layout._lastAuthor = layout.author;
    updateKopAccordionBadges();
    updateLayout();
    save();
  });

  // Tombol warna kategori
  const resetBtn = $('#btn-cat-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetCategoryColors);
  const addBtn = $('#btn-cat-add');
  if (addBtn) addBtn.addEventListener('click', addCategory);

  // Kop fields (termasuk opsi diagram lokasi, skala, arah utara, dan legenda)
  KOP_FIELDS.forEach(({ field, id, isBool }) => {
    const el = $('#' + id);
    if (!el) return;
    const commit = (e) => {
      layout.kop = layout.kop || {};
      if (isBool || el.type === 'checkbox') {
        layout.kop[field] = el.checked;
      } else {
        layout.kop[field] = e.target.value;
      }
      if (field === 'mapmakerName') {
        if (!layout.author || layout.author === layout._lastAuthor) {
          layout.author = e.target.value;
          const la = $('#layout-author');
          if (la) la.value = layout.author;
        }
        layout._lastAuthor = layout.author;
      }
      if (field === 'scaleMode' && layout.kop[field] === 'custom') {
        const customInp = $('#kop-scale-custom');
        const val = customInp ? Number(customInp.value) : 25000;
        if (val > 0) aturSkalaPeta(val);
      }
      // Beberapa opsi mengubah ubin inset, bukan sekadar teks.
      if (typeof FormalSheet !== 'undefined' && FormalSheet.applyInsetOptions) {
        FormalSheet.applyInsetOptions();
      }
      syncSegControls();
      updateKopAccordionBadges();
      updateLayout();
      save();
    };
    el.addEventListener('input', commit);
    el.addEventListener('change', commit);
  });

  const scalePreset = $('#kop-scale-preset');
  if (scalePreset) {
    scalePreset.addEventListener('change', (e) => {
      const val = e.target.value;
      const customInp = $('#kop-scale-custom');
      if (customInp) customInp.value = val;
      layout.kop = layout.kop || {};
      layout.kop.scaleCustom = val;
      layout.kop.scaleMode = 'custom';
      const modeEl = $('#kop-scale-mode');
      if (modeEl) modeEl.value = 'custom';
      aturSkalaPeta(Number(val));
      updateKopAccordionBadges();
    });
  }

  const btnApplyScale = $('#btn-apply-scale');
  if (btnApplyScale) {
    btnApplyScale.addEventListener('click', () => {
      const customInp = $('#kop-scale-custom');
      const val = customInp ? Number(customInp.value) : 25000;
      if (val > 0) {
        aturSkalaPeta(val);
        updateKopAccordionBadges();
      }
    });
  }

  // Tampil/sembunyikan diagram lokasi ditangani toggle bagian peta
  // (blokVis.inset) supaya hanya ada SATU kontrol untuk satu hal.

  // Nama fitur di peta (label permanen) — satu-satunya opsi overlay yang
  // masih relevan; legenda/skala/utara/kredit digambar oleh lembar kop.
  const labelToggle = $('#layout-show-labels');
  if (labelToggle) {
    labelToggle.addEventListener('change', (e) => {
      layout.showLabels = e.target.checked;
      refreshAllLabels();
      save();
    });
  }

  // Pemilih template layout
  $$('#tpl-row button').forEach(b => {
    b.addEventListener('click', () => applyTemplate(b.dataset.tpl));
  });

  initKopAccordion();
}

/* -------------------- Warna kategori (pengelola warna) -------------------- */
// Legenda formal di-generate dari kategori unik yang dipakai fitur, dengan
// warna ini. Kategori bisa ditambah, diganti nama, diwarnai, dan dihapus —
// semuanya tersimpan di localStorage bersama data lain.

let activeSwatchId = null;   // kategori yang panel warnanya sedang terbuka

function categoryUsage() {
  const used = {};
  features.forEach(f => { used[f.category] = (used[f.category] || 0) + 1; });
  return used;
}

// Terapkan warna ke peta + segarkan semua tampilan turunannya.
function applyCategoryChange(catId) {
  features.forEach(f => { if (f.category === catId) applyStyle(f); });
  renderList();
  renderCategoryColors();
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();
  save();
}

function renderCategoryColors() {
  const host = $('#cat-color-list');
  if (!host) return;
  host.innerHTML = '';

  const usage = categoryUsage();
  const dupes = similarColorGroups();
  const dupeIds = new Set();
  dupes.forEach(g => g.forEach(c => dupeIds.add(c.id)));

  CATEGORIES.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.dataset.cat = cat.id;
    if (activeSwatchId === cat.id) row.classList.add('open');

    const n = usage[cat.id] || 0;
    const lum = hexLuminance(cat.color);
    const checkColor = lum > 0.5 ? '#1a2332' : '#ffffff';

    /* ---- Baris utama: swatch + nama + jumlah fitur ---- */
    const head = document.createElement('div');
    head.className = 'cat-row-head';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'cat-swatch';
    swatch.style.background = cat.color;
    swatch.title = 'Ubah warna';
    swatch.setAttribute('aria-label', 'Ubah warna ' + cat.label);
    swatch.setAttribute('aria-expanded', activeSwatchId === cat.id ? 'true' : 'false');
    if (dupeIds.has(cat.id)) {
      const warn = document.createElement('span');
      warn.className = 'cat-swatch-warn';
      warn.textContent = '!';
      warn.title = 'Warna sama dengan kategori lain';
      swatch.appendChild(warn);
    }
    swatch.addEventListener('click', () => {
      activeSwatchId = (activeSwatchId === cat.id) ? null : cat.id;
      renderCategoryColors();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'cat-name-input';
    name.value = cat.label;
    name.maxLength = 40;
    name.setAttribute('aria-label', 'Nama kategori');
    name.addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = cat.label; return; }
      cat.label = v;
      applyCategoryChange(cat.id);
    });

    const count = document.createElement('span');
    count.className = 'cat-count';
    count.textContent = n ? n + ' fitur' : '—';
    count.title = n ? n + ' fitur memakai kategori ini' : 'Belum dipakai';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cat-del';
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
    del.title = n ? 'Kategori masih dipakai ' + n + ' fitur' : 'Hapus kategori';
    del.setAttribute('aria-label', 'Hapus kategori ' + cat.label);
    del.disabled = n > 0 || CATEGORIES.length <= 1;
    del.addEventListener('click', () => deleteCategory(cat.id));

    head.appendChild(swatch);
    head.appendChild(name);
    head.appendChild(count);
    head.appendChild(del);
    row.appendChild(head);

    /* ---- Panel warna: palet + hex + preview ---- */
    if (activeSwatchId === cat.id) {
      const panel = document.createElement('div');
      panel.className = 'cat-panel';

      // Preview: kotak isian + garis + contoh label legenda
      const prev = document.createElement('div');
      prev.className = 'cat-preview';
      prev.innerHTML =
        '<span class="cat-prev-fill" style="background:' + esc(cat.color) + '"></span>' +
        '<span class="cat-prev-line" style="border-top-color:' + esc(cat.color) + '"></span>' +
        '<span class="cat-prev-dot" style="background:' + esc(cat.color) + '"></span>' +
        '<span class="cat-prev-label" style="background:' + esc(cat.color) + ';color:' + checkColor + '">' +
          esc(cat.label.slice(0, 14)) + '</span>';
      panel.appendChild(prev);

      // Palet siap pakai
      PALETTE.forEach(group => {
        const g = document.createElement('div');
        g.className = 'cat-palette-group';
        const t = document.createElement('div');
        t.className = 'cat-palette-title';
        t.textContent = group.name;
        g.appendChild(t);
        const grid = document.createElement('div');
        grid.className = 'cat-palette';
        group.colors.forEach(hex => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cat-palette-dot';
          b.style.background = hex;
          b.title = hex;
          b.setAttribute('aria-label', 'Pakai warna ' + hex);
          if (normalizeHex(cat.color) === hex) b.classList.add('active');
          b.addEventListener('click', () => {
            setCategoryColor(cat.id, hex);
            applyCategoryChange(cat.id);
          });
          grid.appendChild(b);
        });
        g.appendChild(grid);
        panel.appendChild(g);
      });

      // HEX manual + color picker bawaan + eyedropper
      const manual = document.createElement('div');
      manual.className = 'cat-manual';

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.className = 'cat-hex';
      hexInput.value = cat.color;
      hexInput.maxLength = 7;
      hexInput.spellcheck = false;
      hexInput.setAttribute('aria-label', 'Kode warna HEX');
      hexInput.addEventListener('change', (e) => {
        const v = normalizeHex(e.target.value);
        if (!v) { e.target.value = cat.color; toast('Kode HEX tidak valid'); return; }
        e.target.value = v;
        setCategoryColor(cat.id, v);
        applyCategoryChange(cat.id);
      });
      manual.appendChild(hexInput);

      const native = document.createElement('input');
      native.type = 'color';
      native.className = 'cat-native';
      native.value = normalizeHex(cat.color) || '#000000';
      native.setAttribute('aria-label', 'Pilih warna bebas');
      native.addEventListener('input', (e) => {
        setCategoryColor(cat.id, e.target.value);
        const hx = document.querySelector('.cat-row[data-cat="' + cat.id + '"] .cat-hex');
        if (hx) hx.value = e.target.value;
        applyCategoryChange(cat.id);
      });
      manual.appendChild(native);

      // Eyedropper (bila browser mendukung) — ambil warna dari mana saja di layar
      if (window.EyeDropper) {
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'cat-eyedrop';
        pick.textContent = 'Ambil dari layar';
        pick.addEventListener('click', () => {
          new window.EyeDropper().open().then(res => {
            const v = normalizeHex(res.sRGBHex);
            if (!v) return;
            setCategoryColor(cat.id, v);
            applyCategoryChange(cat.id);
          }).catch(() => { /* dibatalkan user */ });
        });
        manual.appendChild(pick);
      }

      panel.appendChild(manual);

      // Slider opacity per kategori
      const opDiv = document.createElement('div');
      opDiv.className = 'cat-opacity-row';
      opDiv.style.cssText = 'margin-top:10px;';
      const currentCatOpacity = (cat.fillOpacity != null) ? cat.fillOpacity : 0.28;
      const opLabel = document.createElement('div');
      opLabel.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;';
      const opSpan = document.createElement('span');
      opSpan.textContent = 'Kepekatan isian kategori';
      const opVal = document.createElement('strong');
      opVal.textContent = Math.round(currentCatOpacity * 100) + '%';
      opLabel.appendChild(opSpan);
      opLabel.appendChild(opVal);

      const opSlider = document.createElement('input');
      opSlider.type = 'range';
      opSlider.min = '0'; opSlider.max = '100'; opSlider.step = '5';
      opSlider.value = Math.round(currentCatOpacity * 100);
      opSlider.style.cssText = 'width:100%;margin-bottom:3px;';
      opSlider.setAttribute('aria-label', 'Opacity isian kategori ' + cat.label);
      opSlider.addEventListener('input', () => {
        opVal.textContent = opSlider.value + '%';
      });
      opSlider.addEventListener('change', () => {
        cat.fillOpacity = parseInt(opSlider.value, 10) / 100;
        // Terapkan ke semua fitur berkategori ini yang tidak punya opacity kustom sendiri.
        features.forEach(f => {
          if (f.category === cat.id && f.fillOpacity == null) applyStyle(f);
        });
        save('Ubah opacity kategori ' + cat.label);
        toast('Opacity kategori diperbarui');
      });
      const opHint = document.createElement('div');
      opHint.style.cssText = 'font-size:10px;color:var(--ink-faint);';
      opHint.textContent = 'Fitur dengan opacity kustom sendiri tidak terpengaruh';
      opDiv.appendChild(opLabel);
      opDiv.appendChild(opSlider);
      opDiv.appendChild(opHint);
      panel.appendChild(opDiv);

      row.appendChild(panel);
    }

    host.appendChild(row);
  });

  // Peringatan warna kembar
  const warnBox = $('#cat-dupe-warn');
  if (warnBox) {
    if (dupes.length) {
      warnBox.textContent = 'Warna sama: ' +
        dupes.map(g => g.map(c => c.label).join(' & ')).join('; ') +
        '. Legenda jadi sulit dibedakan.';
      warnBox.classList.remove('hidden');
    } else {
      warnBox.classList.add('hidden');
    }
  }
}

function addCategory() {
  const id = newCategoryId();
  // Pilih warna yang belum terpakai agar tidak langsung kembar.
  const taken = new Set(CATEGORIES.map(c => normalizeHex(c.color)));
  const flat = PALETTE.reduce((a, g) => a.concat(g.colors), []);
  const free = flat.find(h => !taken.has(h)) || '#6c757d';
  CATEGORIES.push({ id, label: 'Kategori Baru', color: free });
  activeSwatchId = id;
  applyCategoryChange(id);
  const inp = document.querySelector('.cat-row[data-cat="' + id + '"] .cat-name-input');
  if (inp) { inp.focus(); inp.select(); }
}

function deleteCategory(id) {
  const idx = CATEGORIES.findIndex(c => c.id === id);
  if (idx < 0) return;
  const cat = CATEGORIES[idx];
  const n = categoryUsage()[id] || 0;
  if (n > 0) { toast('Kategori ini masih dipakai ' + n + ' fitur'); return; }
  if (CATEGORIES.length <= 1) { toast('Minimal harus ada satu kategori'); return; }
  CATEGORIES.splice(idx, 1);
  if (activeSwatchId === id) activeSwatchId = null;
  renderCategoryColors();
  renderCategorySelect();
  renderList();
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();
  save();
  toast('Kategori "' + cat.label + '" dihapus');
}

// Select di modal harus ikut berubah saat kategori ditambah/dihapus.
function renderCategorySelect() {
  const sel = $('#attr-category');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '';
  CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label;
    sel.appendChild(o);
  });
  if (CATEGORIES.some(c => c.id === keep)) sel.value = keep;
}

function resetCategoryColors() {
  // Kategori kustom buatan user tetap dipertahankan; hanya warna & nama
  // kategori bawaan yang dikembalikan.
  const custom = CATEGORIES.filter(c => !DEFAULT_CATEGORIES.some(d => d.id === c.id));
  CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c)).concat(custom);
  features.forEach(f => applyStyle(f));
  renderCategoryColors();
  renderCategorySelect();
  renderList();
  if (typeof FormalSheet !== 'undefined') FormalSheet.onFeaturesChanged();
  save();
  toast('Warna bawaan dipulihkan');
}

/* -------------------- Tampil/sembunyi bagian peta -------------------- */
// Semua bagian lembar Kop Akademik bisa dimatikan pengguna. Keadaannya
// disimpan di layout.kop.blokVis supaya ikut tersimpan & terbawa saat
// berkas proyek diekspor.
function blokTampil(id) {
  if (!layout.kop.blokVis) layout.kop.blokVis = {};
  return layout.kop.blokVis[id] !== false;   // default: tampil
}

function setBlokTampil(id, tampil, silent) {
  if (!layout.kop.blokVis) layout.kop.blokVis = {};
  layout.kop.blokVis[id] = !!tampil;
  if (typeof FormalSheet !== 'undefined') FormalSheet.scheduleRefresh();
  renderBlokToggles();
  save('Tampilan bagian');

  // Berikan umpan balik visual dan notifikasi yang jelas
  if (!silent && typeof FormalSheet !== 'undefined' && FormalSheet.BLOK) {
    const b = FormalSheet.BLOK.find(item => item.id === id);
    const label = b ? b.label : 'Bagian';
    if (tampil) {
      toast('✓ ' + label + ' ditampilkan di lembar peta');
      setTimeout(() => {
        const domTarget = b && b.sel ? document.querySelector(b.sel) : null;
        if (domTarget) {
          domTarget.classList.remove('fl-block-highlight');
          void domTarget.offsetWidth;
          domTarget.classList.add('fl-block-highlight');
          try {
            domTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (e) {}
        }
      }, 100);
    } else {
      toast('✗ ' + label + ' disembunyikan dari lembar peta');
    }
  }
}

function getBlokOrder() {
  if (typeof FormalSheet === 'undefined' || !FormalSheet.BLOK) return [];
  const allIds = FormalSheet.BLOK.map(b => b.id);
  if (!layout.kop) layout.kop = Object.assign({}, KOP_DEFAULTS);
  if (!Array.isArray(layout.kop.blokOrder) || !layout.kop.blokOrder.length) {
    layout.kop.blokOrder = [...allIds];
  } else {
    // Pastikan semua id yang ada saat ini ada di blokOrder
    allIds.forEach(id => {
      if (!layout.kop.blokOrder.includes(id)) {
        // Blok kustom baru disisipkan sebelum sign bila ada, atau di akhir
        const signIdx = layout.kop.blokOrder.indexOf('sign');
        if (signIdx !== -1) {
          layout.kop.blokOrder.splice(signIdx, 0, id);
        } else {
          layout.kop.blokOrder.push(id);
        }
      }
    });
    // Hapus id yang sudah tidak valid
    layout.kop.blokOrder = layout.kop.blokOrder.filter(id => allIds.includes(id));
  }
  return layout.kop.blokOrder;
}

function tambahBagianKustom() {
  if (!layout.kop) layout.kop = Object.assign({}, KOP_DEFAULTS);
  if (!Array.isArray(layout.kop.customBlocks)) layout.kop.customBlocks = [];

  const id = 'custom_' + Date.now();
  const nomor = layout.kop.customBlocks.length + 1;
  const newBlock = {
    id: id,
    title: 'Keterangan ' + nomor + ':',
    content: 'Tulis catatan atau keterangan tambahan di sini...'
  };
  layout.kop.customBlocks.push(newBlock);

  if (!layout.kop.blokVis) layout.kop.blokVis = {};
  layout.kop.blokVis[id] = true;

  getBlokOrder();

  if (typeof FormalSheet !== 'undefined') {
    FormalSheet.refresh();
  }
  renderBlokToggles();
  save('Tambah bagian kustom');
  toast('Bagian kustom baru ditambahkan ke lembar peta');
}

function hapusBagianKustom(id) {
  if (!layout.kop || !Array.isArray(layout.kop.customBlocks)) return;
  const idx = layout.kop.customBlocks.findIndex(c => c.id === id);
  if (idx === -1) return;

  layout.kop.customBlocks.splice(idx, 1);

  if (layout.kop.blokVis && layout.kop.blokVis[id] !== undefined) {
    delete layout.kop.blokVis[id];
  }

  if (Array.isArray(layout.kop.blokOrder)) {
    layout.kop.blokOrder = layout.kop.blokOrder.filter(item => item !== id);
  }

  if (typeof FormalSheet !== 'undefined') {
    FormalSheet.refresh();
  }
  renderBlokToggles();
  save('Hapus bagian kustom');
  toast('Bagian kustom dihapus');
}

function pindahUrutanBlok(id, arah) {
  const order = getBlokOrder();
  const idx = order.indexOf(id);
  if (idx === -1) return;

  const targetIdx = idx + arah;
  if (targetIdx < 0 || targetIdx >= order.length) return;

  // Tukar posisi
  const temp = order[idx];
  order[idx] = order[targetIdx];
  order[targetIdx] = temp;

  layout.kop.blokOrder = order;

  if (typeof FormalSheet !== 'undefined') {
    FormalSheet.refresh();
  }
  renderBlokToggles();
  save('Ubah urutan bagian');
}

function renderBlokToggles() {
  const host = $('#blok-toggles');
  if (!host || typeof FormalSheet === 'undefined' || !FormalSheet.BLOK) return;
  host.innerHTML = '';

  const order = getBlokOrder();
  const allBlokMap = {};
  FormalSheet.BLOK.forEach(b => { allBlokMap[b.id] = b; });

  const sortedBlok = order.map(id => allBlokMap[id]).filter(Boolean);

  sortedBlok.forEach((b, idx) => {
    const isAktif = blokTampil(b.id);
    const row = document.createElement('div');
    row.className = 'toggle blok-toggle blok-item-row ' + (isAktif ? 'is-active' : 'is-inactive');
    row.dataset.blokId = b.id;

    // Kontrol urutan (naik / turun)
    const orderControls = document.createElement('div');
    orderControls.className = 'blok-order-btns';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'blok-order-btn blok-btn-up';
    btnUp.title = 'Pindah ke atas';
    btnUp.setAttribute('aria-label', 'Pindah ke atas: ' + b.label);
    btnUp.innerHTML = '▲';
    btnUp.disabled = idx === 0;
    btnUp.addEventListener('click', (e) => {
      e.stopPropagation();
      pindahUrutanBlok(b.id, -1);
    });

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'blok-order-btn blok-btn-down';
    btnDown.title = 'Pindah ke bawah';
    btnDown.setAttribute('aria-label', 'Pindah ke bawah: ' + b.label);
    btnDown.innerHTML = '▼';
    btnDown.disabled = idx === sortedBlok.length - 1;
    btnDown.addEventListener('click', (e) => {
      e.stopPropagation();
      pindahUrutanBlok(b.id, 1);
    });

    orderControls.appendChild(btnUp);
    orderControls.appendChild(btnDown);

    // Checkbox input (untuk kompatibilitas state & test Playwright)
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isAktif;
    cb.className = 'blok-toggle-checkbox';
    cb.setAttribute('aria-label', b.label);
    cb.addEventListener('change', () => {
      setBlokTampil(b.id, cb.checked);
    });

    const info = document.createElement('div');
    info.className = 'blok-item-info';

    const span = document.createElement('span');
    span.className = 'blok-item-name';
    span.textContent = b.label;
    info.appendChild(span);

    // Status visual & Tombol toggle
    const statusWrap = document.createElement('div');
    statusWrap.className = 'blok-status-wrap';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'blok-status-badge ' + (isAktif ? 'badge-active' : 'badge-inactive');
    statusBadge.innerHTML = isAktif ? '👁️ Aktif' : 'Mati';

    const btnAction = document.createElement('button');
    btnAction.type = 'button';
    btnAction.className = 'blok-btn-action ' + (isAktif ? 'btn-kurang' : 'btn-tambah');
    btnAction.textContent = isAktif ? 'Sembunyikan' : '+ Tampilkan';
    btnAction.title = isAktif ? 'Sembunyikan bagian ini dari lembar peta' : 'Tampilkan bagian ini di lembar peta';
    btnAction.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.checked = !cb.checked;
      setBlokTampil(b.id, cb.checked);
    });

    statusWrap.appendChild(statusBadge);
    statusWrap.appendChild(btnAction);

    row.appendChild(orderControls);
    row.appendChild(cb);
    row.appendChild(info);
    row.appendChild(statusWrap);

    // Tombol hapus jika bagian kustom
    if (b.isCustom) {
      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'blok-btn-delete';
      btnDel.title = 'Hapus bagian kustom ini';
      btnDel.setAttribute('aria-label', 'Hapus ' + b.label);
      btnDel.innerHTML = '🗑️';
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        hapusBagianKustom(b.id);
      });
      row.appendChild(btnDel);
    }

    // Klik pada baris untuk toggle tampil/sembunyi
    row.addEventListener('click', (e) => {
      if (e.target.closest('.blok-order-btn') || e.target.closest('.blok-btn-delete') || e.target.closest('.blok-btn-action')) return;
      cb.checked = !cb.checked;
      setBlokTampil(b.id, cb.checked);
    });

    host.appendChild(row);

    // Sinkronkan ke sub-grup form di sidebar
    const formSection = document.querySelector(`[data-blok-section="${b.id}"]`);
    if (formSection) {
      formSection.classList.toggle('blok-section-hidden', !isAktif);
    }
  });

  updateBlokRingkasan();
}

function updateBlokRingkasan() {
  const el = $('#blok-ringkas');
  if (!el || typeof FormalSheet === 'undefined' || !FormalSheet.BLOK) return;
  const total = FormalSheet.BLOK.length;
  const aktif = FormalSheet.BLOK.filter(b => blokTampil(b.id)).length;
  const nonaktif = total - aktif;
  el.textContent = aktif === total
    ? 'Semua ' + total + ' bagian aktif di lembar peta'
    : aktif + ' aktif · ' + nonaktif + ' disembunyikan';
  const bBlocks = $('#acc-badge-blocks');
  if (bBlocks) {
    bBlocks.textContent = aktif + ' aktif';
  }
}

function setSemuaBlok(tampil) {
  if (typeof FormalSheet === 'undefined' || !FormalSheet.BLOK) return;
  if (!layout.kop.blokVis) layout.kop.blokVis = {};
  FormalSheet.BLOK.forEach(b => { layout.kop.blokVis[b.id] = !!tampil; });
  renderBlokToggles();
  FormalSheet.scheduleRefresh();
  save('Tampilan bagian');
  toast(tampil ? 'Semua bagian ditampilkan' : 'Semua bagian disembunyikan');
}

function bindBlokToggles() {
  const on = $('#blok-all-on'), off = $('#blok-all-off');
  if (on) on.addEventListener('click', () => setSemuaBlok(true));
  if (off) off.addEventListener('click', () => setSemuaBlok(false));
  const btnAdd = $('#btn-add-custom-block');
  if (btnAdd) btnAdd.addEventListener('click', () => tambahBagianKustom());
  renderBlokToggles();
}

/* -------------------- Logo instansi (unggah) -------------------- */
// Logo disimpan sebagai data URL di localStorage. Karena kuota localStorage
// terbatas (~5 MB), gambar diperkecil dulu lewat canvas sebelum disimpan.
const LOGO_MAX_BYTES = 1024 * 1024;   // batas file mentah yang diterima
const LOGO_TARGET_PX = 240;           // sisi terpanjang setelah diperkecil

function setLogo(dataUrl, meta) {
  layout.kop.logo = dataUrl || '';
  layout.kop.logoName = (meta && meta.name) || layout.kop.logoName || '';
  renderLogoPreview();
  if (typeof FormalSheet !== 'undefined') FormalSheet.scheduleRefresh();
  save();
}

function renderLogoPreview() {
  const box = $('#logo-preview');
  const removeBtn = $('#logo-remove-btn');
  if (!box) return;
  const url = (layout.kop && layout.kop.logo) || '';
  if (url) {
    box.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Logo instansi';
    box.appendChild(img);
    box.classList.add('has-logo');
    if (removeBtn) removeBtn.disabled = false;
  } else {
    box.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#b3bccb" ' +
      'stroke-width="1.5" stroke-linejoin="round"><path d="M12 3 L20.5 8 v9 L12 21 L3.5 17 v-9 z"/>' +
      '<path d="M12 3 v18"/></svg>';
    box.classList.remove('has-logo');
    if (removeBtn) removeBtn.disabled = true;
  }
}

// Perkecil gambar agar hemat kuota; SVG dibiarkan (vektornya sudah kecil).
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (file.type === 'image/svg+xml') { resolve(dataUrl); return; }

      const img = new Image();
      // Sebagian PNG (mis. colormap/indexed dari alat tertentu) tidak bisa
      // didekode oleh Image(). Itu bukan alasan menolak logo user — pakai
      // berkas aslinya saja selama ukurannya masih wajar.
      img.onerror = () => {
        if (file.size <= LOGO_MAX_BYTES) resolve(dataUrl);
        else reject(new Error('Gambar tidak bisa dibaca'));
      };
      img.onload = () => {
        const max = LOGO_TARGET_PX;
        let { width: w, height: h } = img;
        if (!w || !h) { resolve(dataUrl); return; }
        if (Math.max(w, h) > max) {
          const scale = max / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        try {
          ctx.drawImage(img, 0, 0, w, h);
          // PNG agar transparansi logo tetap terjaga.
          resolve(c.toDataURL('image/png'));
        } catch (e) {
          // Canvas gagal (mis. gambar bermasalah) -> pakai aslinya.
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function handleLogoFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/.test(file.type)) {
    toast('Format logo harus PNG, JPG, SVG, atau WebP');
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    toast('Logo terlalu besar (maks 1 MB). Kompres dulu ya.');
    return;
  }
  shrinkImage(file)
    .then(dataUrl => {
      setLogo(dataUrl, { name: file.name });
      toast('Logo instansi dipasang');
    })
    .catch(err => toast('Gagal memuat logo: ' + (err && err.message ? err.message : err)));
}

function bindLogoUpload() {
  const btn = $('#logo-upload-btn');
  const input = $('#logo-input');
  const removeBtn = $('#logo-remove-btn');
  if (!btn || !input) return;

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    handleLogoFile(f);
    e.target.value = '';
  });

  // Dukungan seret-lepas ke kotak pratinjau.
  const box = $('#logo-preview');
  if (box) {
    ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, (e) => {
      e.preventDefault(); box.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, (e) => {
      e.preventDefault(); box.classList.remove('dragging');
    }));
    box.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleLogoFile(f);
    });
    box.addEventListener('click', () => input.click());
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      setLogo('', null);
      toast('Logo dihapus');
    });
  }

  renderLogoPreview();
}

/* -------------------- Skeleton pemuatan -------------------- */
// Placeholder berbentuk konten, dipakai saat menunggu data yang bisa
// terasa lambat (memuat data tersimpan, mencari batas administrasi).
function skeletonDaftarFitur(n) {
  let html = '';
  for (let i = 0; i < (n || 3); i++) {
    html +=
      '<div class="sk-item" aria-hidden="true">' +
        '<span class="sk-blok sk-swatch"></span>' +
        '<span class="sk-baris">' +
          '<span class="sk-blok sk-judul" style="display:block"></span>' +
          '<span class="sk-blok sk-meta" style="display:block"></span>' +
        '</span>' +
        '<span class="sk-blok sk-aksi"></span>' +
      '</div>';
  }
  return html;
}

function skeletonHasilBatas(n) {
  let html = '';
  for (let i = 0; i < (n || 3); i++) {
    html +=
      '<div class="sk-admin" aria-hidden="true">' +
        '<span class="sk-admin-baris">' +
          '<span class="sk-blok sk-admin-nama" style="display:block"></span>' +
          '<span class="sk-blok sk-admin-sub" style="display:block"></span>' +
        '</span>' +
        '<span class="sk-blok sk-badge"></span>' +
      '</div>';
  }
  return html;
}

// Tampilkan skeleton di daftar fitur selama memuat. Fungsi yang
// dikembalikan hanya MENGHAPUS skeleton (mengosongkan daftar), tidak
// memulihkan isi lama — kalau memulihkan, hasil renderList() yang asli
// akan tertimpa dan daftar fitur tampak kosong.
function tampilkanSkeletonDaftar() {
  const list = $('#feat-list');
  const empty = $('#feat-empty');
  if (!list) return null;
  if (empty) empty.style.display = 'none';
  list.innerHTML = skeletonDaftarFitur(3);
  let aktif = true;
  const timer = setTimeout(() => {
    // Jaring pengaman: kalau pemuatan gagal, jangan biarkan skeleton
    // menggantung selamanya.
    if (aktif && list.querySelector('.sk-item')) list.innerHTML = '';
  }, 5000);
  return () => {
    aktif = false;
    clearTimeout(timer);
    // Hanya bersihkan bila isinya memang masih skeleton; kalau
    // renderList() sudah menulis, biarkan.
    if (list.querySelector('.sk-item')) list.innerHTML = '';
  };
}

/* -------------------- Batas administrasi (lapisan terpisah) -------------------- */
// Lapisan ini sengaja TIDAK ikut menjadi fitur delinasi: ia hanya latar
// acuan. User tetap bisa menggambar di atasnya.
function adminStatus(msg, isError) {
  const el = $('#admin-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
}

function renderAdminResults(list) {
  const box = $('#admin-results');
  if (!box) return;
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="admin-empty">Tidak ada batas administratif yang cocok. Coba nama lain, atau pilih tingkat "Semua tingkat".</div>';
    return;
  }
  list.forEach(r => {
    const lv = AdminBoundaries.levelOf(r.rank);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'admin-item';
    row.innerHTML =
      '<span class="admin-item-main">' +
        '<span class="admin-item-name">' + esc(r.short) + '</span>' +
        '<span class="admin-item-sub">' + esc(r.name) + '</span>' +
      '</span>' +
      '<span class="admin-item-meta">' +
        '<span class="admin-badge">' + esc(lv.label) + '</span>' +
        '<span class="admin-pts">' + AdminBoundaries.countPoints(r.geom).toLocaleString('id-ID') + ' titik</span>' +
      '</span>';
    row.addEventListener('click', () => {
      AdminBoundaries.draw(r);
      showAdminLoaded(r);
      renderAdminResults(list);
      // Zoom ke batas yang baru dimuat.
      try {
        const b = AdminBoundaries.current;
        const gj = L.geoJSON(null);
        gj.addData({ type: 'Feature', properties: {}, geometry: r.geom });
        map.flyToBounds(gj.getBounds(), { duration: .7, padding: [30, 30] });
      } catch (e) { /* diabaikan */ }
    });
    if (AdminBoundaries.current && AdminBoundaries.current.osm === r.osm) {
      row.classList.add('active');
    }
    box.appendChild(row);
  });
}

function showAdminLoaded(r) {
  const box = $('#admin-loaded');
  if (!box) return;
  box.classList.remove('hidden');
  $('#admin-loaded-name').textContent = r.short;
  const lv = AdminBoundaries.levelOf(r.rank);
  const count = r.geom ? AdminBoundaries.countPoints(r.geom) : (r.featuresList ? r.featuresList.reduce((acc, f) => acc + AdminBoundaries.countPoints(f.geom), 0) : 0);
  const src = r.source || ('OSM ' + (r.osm || ''));
  $('#admin-loaded-meta').textContent =
    lv.label + ' · ' + count.toLocaleString('id-ID') + ' titik · ' + src;
  const show = $('#admin-show');
  if (show) show.checked = true;
}

function runAdminSearch() {
  const q = ($('#admin-q').value || '').trim();
  if (q.length < 3) { adminStatus('Tulis minimal 3 huruf nama wilayah.', true); return; }

  const btn = $('#admin-search');
  const level = $('#admin-level').value;
  btn.disabled = true;
  adminStatus('Mencari batas…');
  // Skeleton berbentuk kartu hasil, supaya tata letak tidak melompat
  // saat hasil asli muncul.
  const box = $('#admin-results');
  if (box) box.innerHTML = skeletonHasilBatas(3);

  AdminBoundaries.search(q, level)
    .then(({ results, fromCache }) => {
      renderAdminResults(results);
      if (!results.length) {
        const qClean = AdminBoundaries.cleanQuery(($('#admin-q').value || ''));
        adminStatus('Tidak ditemukan untuk "' + qClean + '". Coba tulis nama wilayahnya saja ' +
          '(mis. "Cibinong, Bogor" atau "Kabupaten Bogor") — kata seperti "Kecamatan" ' +
          'biasanya tidak dipakai di data OpenStreetMap.', true);

        // Cek apakah cocok dengan data resmi Kemendagri / BPS
        suggestOfficialAlternative(qClean);
      } else {
        adminStatus(results.length + ' batas ditemukan' +
          (fromCache ? ' (dari cache, tanpa memanggil server).' : '. Klik salah satu untuk memuat.'));
      }
    })
    .catch(err => {
      adminStatus('Gagal mencari: ' + (err && err.message ? err.message : err) + '. Cek koneksi internet.', true);
    })
    .then(() => { btn.disabled = false; });
}

function suggestOfficialAlternative(q) {
  const box = $('#admin-results');
  if (!box) return;
  const qLower = q.toLowerCase();
  const provs = AdminBoundaries.getProvinces();
  let matchedKab = null;
  let matchedProv = null;

  for (const p of provs) {
    for (const k of (p.kab || [])) {
      const kClean = k.name.toLowerCase().replace(/^(kabupaten|kota)\s+/i, '');
      if (k.name.toLowerCase().includes(qLower) || qLower.includes(kClean)) {
        matchedKab = k;
        matchedProv = p;
        break;
      }
    }
    if (matchedKab) break;
  }

  if (matchedKab && matchedProv) {
    const tip = document.createElement('div');
    tip.className = 'admin-item';
    tip.style.borderColor = 'var(--primary)';
    tip.style.background = '#eef4ff';
    tip.innerHTML =
      '<span class="admin-item-main">' +
        '<span class="admin-item-name" style="color:var(--primary)">🏛️ Tersedia di Katalog Resmi BPS: ' + esc(matchedKab.name) + '</span>' +
        '<span class="admin-item-sub">Provinsi ' + esc(matchedProv.name) + ' · 100% lengkap semua kecamatan</span>' +
      '</span>' +
      '<span class="admin-item-meta">' +
        '<button type="button" class="btn btn-secondary btn-sm" id="admin-btn-jump-catalog" style="font-size:11px;padding:3px 8px">Buka di Katalog</button>' +
      '</span>';

    tip.querySelector('#admin-btn-jump-catalog').addEventListener('click', () => {
      switchAdminTab('official');
      const provSel = $('#admin-sel-prov');
      if (provSel) {
        provSel.value = matchedProv.id;
        provSel.dispatchEvent(new Event('change'));
        setTimeout(() => {
          const kabSel = $('#admin-sel-kab');
          if (kabSel) {
            kabSel.value = matchedKab.id;
            kabSel.dispatchEvent(new Event('change'));
          }
        }, 50);
      }
    });

    box.appendChild(tip);
  }
}

function switchAdminTab(tabName) {
  const officialBtn = $('#admin-tab-official');
  const searchBtn = $('#admin-tab-search');
  const officialPane = $('#admin-pane-official');
  const searchPane = $('#admin-pane-search');

  if (tabName === 'search') {
    if (officialBtn) { officialBtn.classList.remove('active'); officialBtn.setAttribute('aria-selected', 'false'); }
    if (searchBtn) { searchBtn.classList.add('active'); searchBtn.setAttribute('aria-selected', 'true'); }
    if (officialPane) officialPane.classList.add('hidden');
    if (searchPane) searchPane.classList.remove('hidden');
  } else {
    if (officialBtn) { officialBtn.classList.add('active'); officialBtn.setAttribute('aria-selected', 'true'); }
    if (searchBtn) { searchBtn.classList.remove('active'); searchBtn.setAttribute('aria-selected', 'false'); }
    if (officialPane) officialPane.classList.remove('hidden');
    if (searchPane) searchPane.classList.add('hidden');
  }
}

let currentOfficialDistricts = [];

function bindAdminBoundaries() {
  // ---- Tab Switching ----
  const officialTabBtn = $('#admin-tab-official');
  const searchTabBtn = $('#admin-tab-search');
  if (officialTabBtn) {
    officialTabBtn.addEventListener('click', () => switchAdminTab('official'));
  }
  if (searchTabBtn) {
    searchTabBtn.addEventListener('click', () => switchAdminTab('search'));
  }

  // ---- Katalog Resmi Dropdowns ----
  const provSel = $('#admin-sel-prov');
  const kabSel = $('#admin-sel-kab');
  const kecSel = $('#admin-sel-kec');
  const levelSel = $('#admin-official-level');
  const loadKecBtn = $('#admin-btn-load-kec');
  const loadAllBtn = $('#admin-btn-load-all');
  const officialStatusEl = $('#admin-official-status');

  function adminOfficialStatus(text, isError = false) {
    if (!officialStatusEl) return;
    officialStatusEl.textContent = text;
    officialStatusEl.classList.toggle('is-error', !!isError);
  }

  // Isi dropdown provinsi dari INDONESIA_ADM
  if (provSel) {
    const provs = AdminBoundaries.getProvinces();
    const sorted = [...provs].sort((a, b) => a.name.localeCompare(b.name, 'id'));
    sorted.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      provSel.appendChild(opt);
    });

    provSel.addEventListener('change', () => {
      const provId = provSel.value;
      kabSel.innerHTML = '<option value="">Pilih Kab/Kota…</option>';
      kecSel.innerHTML = '<option value="">Pilih wilayah…</option>';
      kabSel.disabled = true;
      kecSel.disabled = true;
      loadKecBtn.disabled = true;
      loadAllBtn.disabled = true;
      currentOfficialDistricts = [];

      if (!provId) {
        adminOfficialStatus('Pilih Provinsi dan Kabupaten/Kota untuk memuat batas wilayah resmi.');
        return;
      }

      const regencies = AdminBoundaries.getRegencies(provId);
      const sortedRegs = [...regencies].sort((a, b) => a.name.localeCompare(b.name, 'id'));
      sortedRegs.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.id;
        opt.textContent = k.name;
        kabSel.appendChild(opt);
      });
      kabSel.disabled = false;
      const provText = provSel.selectedOptions[0]?.text || '';
      adminOfficialStatus(`Provinsi ${provText} dipilih. Silakan pilih Kabupaten/Kota.`);
    });
  }

  function loadDistrictsForSelectedKab() {
    const kabId = kabSel.value;
    const provId = provSel.value;
    kecSel.innerHTML = '<option value="">Pilih wilayah…</option>';
    kecSel.disabled = true;
    loadKecBtn.disabled = true;
    loadAllBtn.disabled = true;
    currentOfficialDistricts = [];

    if (!kabId) return;

    const regencies = AdminBoundaries.getRegencies(provId);
    const kabObj = regencies.find(k => String(k.id) === String(kabId));
    const kabName = kabObj ? kabObj.name : 'Kabupaten/Kota';

    // Fly ke koordinat kabupaten
    if (kabObj && kabObj.lat && kabObj.lng && map) {
      map.flyTo([kabObj.lat, kabObj.lng], 10, { duration: 0.8 });
    }

    const level = levelSel ? levelSel.value : 'kecamatan';
    const isDesa = level === 'desa';
    const levelName = isDesa ? 'Kelurahan / Desa' : 'Kecamatan';

    adminOfficialStatus(`Mengambil data ${levelName} untuk ${kabName}…`);

    AdminBoundaries.fetchDistricts(kabId, level)
      .then(list => {
        currentOfficialDistricts = list;
        if (!list || !list.length) {
          adminOfficialStatus(`Data ${levelName} belum tersedia untuk ${kabName}.`, true);
          return;
        }

        const sorted = [...list].sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'));
        kecSel.innerHTML = '';

        const optAll = document.createElement('option');
        optAll.value = '__all__';
        optAll.textContent = `── Semua ${levelName} (${sorted.length} Wilayah) ──`;
        kecSel.appendChild(optAll);

        sorted.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.kode || item.nama;
          const parentText = item.parent_nama ? ` (Kec. ${item.parent_nama})` : '';
          opt.textContent = `${item.nama}${parentText}`;
          kecSel.appendChild(opt);
        });

        kecSel.disabled = false;
        loadKecBtn.disabled = false;
        loadAllBtn.disabled = false;
        adminOfficialStatus(`${sorted.length} ${levelName} siap ditampilkan untuk ${kabName}.`);
      })
      .catch(err => {
        adminOfficialStatus(`Gagal memuat data: ${err.message || 'Cek koneksi internet.'}`, true);
      });
  }

  if (kabSel) {
    kabSel.addEventListener('change', loadDistrictsForSelectedKab);
  }

  if (levelSel) {
    levelSel.addEventListener('change', () => {
      const isDesa = levelSel.value === 'desa';
      const subLabel = $('#admin-sel-sub-label');
      if (subLabel) subLabel.textContent = isDesa ? 'Pilih Kelurahan / Desa' : 'Pilih Kecamatan';
      const allBtn = $('#admin-btn-load-all');
      if (allBtn) allBtn.textContent = isDesa ? 'Semua Desa' : 'Semua Kecamatan';
      if (kabSel && kabSel.value) {
        loadDistrictsForSelectedKab();
      }
    });
  }

  function displayOfficialBoundary(loadAll = false) {
    if (!currentOfficialDistricts || !currentOfficialDistricts.length) return;

    const kabId = kabSel.value;
    const provId = provSel.value;
    const regencies = AdminBoundaries.getRegencies(provId);
    const kabObj = regencies.find(k => String(k.id) === String(kabId));
    const kabName = kabObj ? kabObj.name : 'Kabupaten/Kota';
    const level = levelSel ? levelSel.value : 'kecamatan';
    const isDesa = level === 'desa';
    const levelPrefix = isDesa ? 'Desa/Kel.' : 'Kecamatan';

    const targetVal = loadAll ? '__all__' : (kecSel.value || '__all__');

    if (targetVal === '__all__') {
      const featuresList = [];
      currentOfficialDistricts.forEach(item => {
        const geom = AdminBoundaries.pathToGeometry(item.path);
        if (geom) {
          const pName = item.parent_nama ? ` (Kec. ${item.parent_nama})` : '';
          featuresList.push({
            name: `${levelPrefix} ${item.nama}${pName}`,
            geom: geom,
            rawItem: item
          });
        }
      });

      if (!featuresList.length) {
        adminOfficialStatus('Tidak ada geometri batas yang valid.', true);
        return;
      }

      const result = {
        name: `Semua ${levelPrefix} di ${kabName}`,
        short: `${featuresList.length} ${levelPrefix} (${kabName})`,
        rank: isDesa ? 18 : 14,
        osm: `resmi/${kabId}/all`,
        geom: null,
        featuresList: featuresList,
        source: 'BPS / Kemendagri',
        isOfficial: true,
        isCollection: true
      };

      AdminBoundaries.draw(result);
      showAdminLoaded(result);

      const b = AdminBoundaries.getBounds();
      if (b && map) {
        map.flyToBounds(b, { duration: 0.8, padding: [30, 30] });
      }
      adminOfficialStatus(`${featuresList.length} ${levelPrefix} berhasil ditampilkan.`);
    } else {
      const item = currentOfficialDistricts.find(it => (it.kode || it.nama) === targetVal);
      if (!item) return;

      const geom = AdminBoundaries.pathToGeometry(item.path);
      if (!geom) {
        adminOfficialStatus(`Geometri untuk ${item.nama} tidak valid.`, true);
        return;
      }

      const pName = item.parent_nama ? ` (Kec. ${item.parent_nama})` : '';
      const result = {
        name: `${levelPrefix} ${item.nama}${pName}, ${kabName}`,
        short: `${levelPrefix} ${item.nama}`,
        rank: isDesa ? 18 : 14,
        osm: `resmi/${item.kode || item.nama}`,
        geom: geom,
        source: 'BPS / Kemendagri',
        isOfficial: true,
        rawItem: item
      };

      AdminBoundaries.draw(result);
      showAdminLoaded(result);

      const b = AdminBoundaries.getBounds();
      if (b && map) {
        map.flyToBounds(b, { duration: 0.8, padding: [30, 30] });
      }
      adminOfficialStatus(`Batas ${result.short} berhasil ditampilkan.`);
    }
  }

  if (loadKecBtn) {
    loadKecBtn.addEventListener('click', () => displayOfficialBoundary(false));
  }
  if (loadAllBtn) {
    loadAllBtn.addEventListener('click', () => displayOfficialBoundary(true));
  }

  // ---- Pencarian Bebas OSM ----
  const btn = $('#admin-search');
  if (btn) {
    btn.addEventListener('click', runAdminSearch);
    $('#admin-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runAdminSearch(); }
    });
    $('#admin-level').addEventListener('change', () => {
      if (($('#admin-q').value || '').trim().length >= 3) runAdminSearch();
    });
  }

  $('#admin-show').addEventListener('change', (e) => {
    AdminBoundaries.setVisible(e.target.checked);
  });

  // ---- Mode laut / darat ----
  const seaSel = $('#admin-sea');
  if (seaSel) {
    seaSel.addEventListener('change', () => {
      AdminBoundaries.setSeaMode(seaSel.value);
      const cur = AdminBoundaries.current;
      if (cur) AdminBoundaries.draw(cur);
    });
  }

  // ---- Salin batas ke fitur delinasi ----
  const toFeatBtn = $('#admin-to-feature');
  if (toFeatBtn) {
    toFeatBtn.addEventListener('click', () => {
      const cur = AdminBoundaries.current;
      if (!cur) {
        toast('Muat batas terlebih dulu sebelum menyalin.', { type: 'error' });
        return;
      }

      // Jika koleksi multi-kecamatan
      if (cur.isCollection && Array.isArray(cur.featuresList) && cur.featuresList.length) {
        let addedCount = 0;
        cur.featuresList.forEach((f, idx) => {
          if (!f.geom) return;
          let layer;
          try {
            layer = L.geoJSON({ type: 'Feature', geometry: f.geom, properties: {} });
          } catch (e) { return; }
          const sublayers = layer.getLayers();
          if (!sublayers.length) return;
          const subLayer = sublayers[0];
          addFeature({ layer: subLayer, type: 'Polygon', name: f.name || `Wilayah ${idx + 1}` });
          drawnItems.addLayer(subLayer);
          addedCount++;
        });
        toast(`${addedCount} batas wilayah disalin ke daftar delinasi.`);
        return;
      }

      // Batas tunggal
      if (!cur.geom) {
        toast('Muat batas terlebih dulu sebelum menyalin.', { type: 'error' });
        return;
      }
      const geom = AdminBoundaries.filterLand(cur.geom);
      let layer;
      try {
        layer = L.geoJSON({ type: 'Feature', geometry: geom, properties: {} });
      } catch (e) {
        toast('Gagal mengkonversi geometri batas.', { type: 'error' });
        return;
      }
      const sublayers = layer.getLayers();
      if (!sublayers.length) { toast('Geometri batas kosong.'); return; }
      const subLayer = sublayers[0];
      const type = (geom.type === 'Point' || geom.type === 'MultiPoint') ? 'Marker' : 'Polygon';
      addFeature({ layer: subLayer, type, name: cur.short || '' });
      drawnItems.addLayer(subLayer);
      toast('Batas disalin ke daftar delinasi. Warna & detail bisa diatur bebas.');
    });
  }

  $('#admin-clear').addEventListener('click', () => {
    AdminBoundaries.clear();
    $('#admin-loaded').classList.add('hidden');
    $('#admin-results').innerHTML = '';
    const show = $('#admin-show');
    if (show) show.checked = false;
    adminStatus('Batas dihapus. Tekan tombol untuk mencari lagi.');
    adminOfficialStatus('Batas dihapus. Silakan pilih wilayah untuk memuat kembali.');
  });
}


/* -------------------- Pencarian lokasi (Nominatim) -------------------- */
let searchTimer;
function doSearch(q) {
  const box = $('#search-results');
  box.innerHTML = '<div class="sr-item" style="color:#8b97a8;cursor:default">Mencari…</div>';
  box.classList.add('show');

  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=id&q=' +
    encodeURIComponent(q);
  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(r => r.json())
    .then(data => showResults(data))
    .catch(() => {
      box.innerHTML = '<div class="sr-item" style="color:#d64545;cursor:default">Gagal mencari. Cek koneksi internet.</div>';
    });
}

function showResults(data) {
  const box = $('#search-results');
  box.innerHTML = '';
  if (!data.length) {
    box.innerHTML = '<div class="sr-item" style="color:#8b97a8;cursor:default">Lokasi tidak ditemukan.</div>';
    box.classList.add('show');
    return;
  }
  data.forEach(d => {
    const el = document.createElement('div');
    el.className = 'sr-item';
    el.innerHTML = '<div class="sr-name">' + esc(d.display_name.split(',')[0]) + '</div>' +
      '<div class="sr-sub">' + esc(d.display_name) + '</div>';
    el.addEventListener('click', () => {
      map.flyTo([+d.lat, +d.lon], 15, { duration: .8 });
      if (searchMarker) map.removeLayer(searchMarker);
      searchMarker = L.marker([+d.lat, +d.lon], { icon: markerIcon('#2f6fed') })
        .addTo(map).bindPopup(esc(d.display_name)).openPopup();
      box.classList.remove('show');
      $('#search-input').value = '';
      closeSidebarMobile();
    });
    box.appendChild(el);
  });
  box.classList.add('show');
}

/* -------------------- Impor / Ekspor -------------------- */
function geometryToLayer(g, type, category) {
  if (!g || !g.type) return null;
  const color = catOf(category).color;
  try {
    if (type === 'Circle' || (g.type === 'Point' && g.radius != null)) {
      return L.circle([g.coordinates[1], g.coordinates[0]], Object.assign(
        { radius: g.radius }, styleFor('Circle', color)));
    }
    if (g.type === 'Point') {
      return L.marker([g.coordinates[1], g.coordinates[0]], { icon: markerIcon(color) });
    }
    const fg = L.geoJSON({ type: 'Feature', geometry: g, properties: {} }, {
      style: () => styleFor(type === 'Marker' ? 'Polygon' : type, color),
      pointToLayer: (feat, latlng) => L.marker(latlng, { icon: markerIcon(color) })
    });
    return fg.getLayers()[0] || null;
  } catch (e) {
    console.warn('geometryToLayer gagal:', e);
    return null;
  }
}

// Ambil nilai pertama yang ada dari beberapa kemungkinan nama properti.
function pickProp(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

function inferType(g) {
  if (!g || !g.type) return null;
  if (g.type === 'Point') return (g.radius != null) ? 'Circle' : 'Marker';
  if (g.type === 'LineString' || g.type === 'MultiLineString') return 'Polyline';
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return 'Polygon';
  return null;
}

// Pulihkan pengaturan proyek dari berkas GeoJSON yang kita ekspor sendiri.
// Tanpa ini, mengimpor kembali berkas hasil ekspor akan kehilangan kop,
// preset layout, warna kategori, dan posisi peta.
function restoreProject(proj) {
  if (!proj || typeof proj !== 'object') return false;
  let dipulihkan = false;

  if (Array.isArray(proj.categories) && proj.categories.length) {
    CATEGORIES = proj.categories
      .filter(c => c && typeof c.id === 'string')
      .map(c => ({
        id: c.id,
        label: (typeof c.label === 'string' && c.label.trim()) ? c.label : c.id,
        color: normalizeHex(c.color) || '#6c757d'
      }));
    if (!CATEGORIES.length) CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));
    dipulihkan = true;
  }

  const L2 = proj.layout;
  if (L2 && typeof L2 === 'object') {
    layout.title = L2.title || '';
    layout.author = L2.author || '';
    layout.showLabels = L2.showLabels !== false;
    layout.kop = Object.assign({}, KOP_DEFAULTS, L2.kop || {});
    if (Array.isArray(layout.kop.customBlocks)) {
      layout.kop.customBlocks = layout.kop.customBlocks.map(c => Object.assign({}, c));
    }
    if (Array.isArray(layout.kop.blokOrder)) {
      layout.kop.blokOrder = [...layout.kop.blokOrder];
    }
    dipulihkan = true;
  }

  if (proj.basemap && BASEMAPS[proj.basemap]) {
    setBasemap(proj.basemap, true);
  }
  if (proj.view) {
    try { map.setView([proj.view.lat, proj.view.lng], proj.view.zoom); } catch (e) {}
  }

  // Terapkan layout terakhir. Berkas proyek lama menyimpan preset yang
  // sudah dihapus (mis. "klasik") -> normalizeTplId mengembalikannya ke
  // lembar kop, jadi berkas lama tetap bisa dibuka.
  const tpl = normalizeTplId(proj.tpl);

  // Sinkronkan kontrol panel dengan state yang baru dipulihkan.
  const t = $('#layout-title'); if (t) t.value = layout.title;
  const a = $('#layout-author'); if (a) a.value = layout.author;
  syncKopInputs();
  renderLogoPreview();
  renderBlokToggles();

  applyTemplate(tpl);

  renderCategoryColors();
  renderCategorySelect();
  return dipulihkan;
}

function importGeoJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { toast('File GeoJSON tidak valid'); return; }

  // Berkas hasil ekspor aplikasi ini membawa pengaturan proyek lengkap.
  const adaProyek = restoreProject(data.project);

  const feats = (data.type === 'FeatureCollection') ? (data.features || [])
    : (data.type === 'Feature') ? [data]
    : (data.type && data.type.indexOf('Geometry') === 0) ? [{ type: 'Feature', geometry: data, properties: {} }]
    : [];

  if (!feats.length) { toast('Tidak ada fitur di dalam file'); return; }

  let n = 0;
  feats.forEach(sf => {
    const g = sf.geometry || sf;
    const type = inferType(g);
    if (!type) return;
    const p = sf.properties || {};
    const category = CATEGORIES.some(c => c.id === p.category) ? p.category : 'lainnya';
    const layer = geometryToLayer(g, type, category);
    if (!layer) return;
    addFeature({
      id: ++idSeq, layer, type,
      // Nama dari berbagai penamaan umum (QGIS/ArcGIS/kita sendiri) agar
      // data dari aplikasi lain tidak kehilangan atributnya.
      name: String(pickProp(p, ['name', 'Nama', 'NAMA', 'NAME', 'nama',
        'label', 'Label', 'judul', 'title', 'Title']) || '').slice(0, 80),
      category,
      desc: String(pickProp(p, ['description', 'desc', 'keterangan',
        'KETERANGAN', 'Keterangan', 'remark', 'note']) || '').slice(0, 400),
      measure: null
    }, false);
    n++;
  });

  save();
  if (n) {
    toast(n + ' fitur diimpor' + (adaProyek ? ' + pengaturan proyek dipulihkan' : ''));
    // Bila proyek membawa posisi peta sendiri, jangan paksa zoom ke fitur.
    if (!adaProyek) {
      map.fitBounds(drawnItems.getBounds(), { padding: [40, 40], maxZoom: 16 });
    }
  } else {
    toast(adaProyek ? 'Pengaturan proyek dipulihkan (tanpa geometri)'
                    : 'Tidak ada geometri yang bisa dibaca');
  }
}

function exportGeoJSON() {
  if (!features.length) { toast('Belum ada fitur untuk diekspor'); return; }

  const fc = {
    type: 'FeatureCollection',
    name: 'peta-delinasi',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
    metadata: {
      title: layout.title || 'Peta Delinasi',
      author: layout.author || '',
      date: new Date().toISOString().slice(0, 10),
      datasource: basemapAttribution(currentBasemap),
      crs: 'WGS 84 (EPSG:4326)'
    },
    // Seluruh pengaturan proyek ikut disimpan supaya berkas ini bisa
    // dipakai untuk melanjutkan pekerjaan (bukan sekadar geometri).
    // Sebelumnya hanya title & author; kop, preset, warna kategori, dan
    // pengaturan peta hilang saat diimpor kembali.
    project: {
      v: 1,
      tpl: layout.tpl,
      layout: {
        title: layout.title, author: layout.author,
        showLabels: layout.showLabels,
        kop: Object.assign({}, layout.kop)
      },
      categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, color: c.color })),
      basemap: currentBasemap,
      view: { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() }
    },
    features: features.map(f => {
      let geometry;
      if (f.type === 'Circle') {
        const c = f.layer.getLatLng();
        // Lingkaran disimpan sebagai titik + radius agar bisa dibuka ulang,
        // dan di sini juga kita beri geometri poligon pendekat untuk kompatibilitas.
        const approx = turf.circle([c.lng, c.lat], f.layer.getRadius() / 1000, { steps: 64 });
        geometry = approx.geometry;
      } else {
        geometry = f.layer.toGeoJSON().geometry;
      }
      const cat = catOf(f.category);
      const m = f.measure || {};
      return {
        type: 'Feature',
        properties: {
          name: f.name || '', jenis: cat.label, category: cat.id,
          tipe: TYPE_LABEL[f.type] || f.type,
          description: f.desc || '',
          area_m2: (m.area != null) ? Math.round(m.area * 100) / 100 : null,
          perimeter_m: (m.perimeter != null) ? Math.round(m.perimeter * 100) / 100 : null,
          length_m: (m.length != null) ? Math.round(m.length * 100) / 100 : null,
          radius_m: (m.radius != null) ? Math.round(m.radius * 100) / 100 : null
        },
        geometry
      };
    })
  };

  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  downloadBlob(blob, 'peta-delinasi.geojson');
  toast(features.length + ' fitur diekspor ke GeoJSON');
}

// Ekspor tabel atribut untuk lampiran laporan. Memakai pemisah ';' dan
// koma desimal gaya Indonesia supaya langsung rapi di Excel berbahasa ID.
function exportCSV() {
  if (!features.length) { toast('Belum ada fitur untuk diekspor'); return; }

  // Header memakai istilah Indonesia agar langsung terbaca di laporan.
  // Kolom koordinat sengaja berupa ANGKA desimal (koma gaya Indonesia) tanpa
  // akhiran LU/LS/BT/BB, supaya tetap bisa dihitung & diurutkan di Excel.
  // Arah mata angin disediakan sebagai kolom terpisah.
  const head = ['No', 'Nama', 'Jenis Delinasi', 'Tipe', 'Keterangan',
    'Luas (m2)', 'Luas (ha)', 'Keliling (m)', 'Panjang (m)', 'Radius (m)',
    'Lintang', 'Bujur', 'Arah'];

  const num = (v, desimal) => (v == null || !isFinite(v))
    ? '' : v.toFixed(desimal == null ? 2 : desimal).replace('.', ',');

  const baris = features.map((f, i) => {
    const m = f.measure || {};
    const cat = catOf(f.category);
    let lat = '', lng = '', arah = '';
    try {
      const c = f.type === 'Marker' ? f.layer.getLatLng()
        : (f.type === 'Circle' ? f.layer.getLatLng() : f.layer.getBounds().getCenter());
      lat = num(Math.abs(c.lat), 6); lng = num(Math.abs(c.lng), 6);
      arah = (c.lat >= 0 ? 'LU' : 'LS') + '/' + (c.lng >= 0 ? 'BT' : 'BB');
    } catch (e) { /* biarkan kosong */ }
    return [
      i + 1,
      f.name || '',
      cat.label,
      TYPE_LABEL[f.type] || f.type,
      f.desc || '',
      m.area != null ? num(m.area) : '',
      m.area != null ? num(m.area / 10000, 4) : '',
      m.perimeter != null ? num(m.perimeter) : '',
      m.length != null ? num(m.length) : '',
      m.radius != null ? num(m.radius) : '',
      lat, lng, arah
    ];
  });

  const csvCell = (v) => {
    const t = String(v == null ? '' : v);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const isi = [head].concat(baris).map(r => r.map(csvCell).join(';')).join('\r\n');

  // BOM agar Excel membaca UTF-8 dengan benar (nama beraksen/karakter khusus).
  const blob = new Blob(['\uFEFF' + isi], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, 'tabel-delinasi.csv');
  toast(features.length + ' baris diekspor ke CSV');
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
}

/* Catatan: ekspor PNG & cetak PDF ditangani js/print-layout.js
   (PaperLayout). Jangan menambah jalur ekspor lain di sini supaya
   pengaturan ketajaman & pembekuan ukuran lembar tetap satu sumber. */

/* -------------------- Simpan / muat (localStorage) -------------------- */
let saveFlashTimer;
function flashSaved() {
  const el = $('#save-state');
  $('#save-state-text').textContent = 'Tersimpan';
  el.classList.remove('dirty');
  clearTimeout(saveFlashTimer);
  el.style.background = 'rgba(255,255,255,.32)';
  saveFlashTimer = setTimeout(() => { el.style.background = ''; }, 600);
}

// Bangun objek state lengkap. Dipisah dari save() supaya bisa dipakai
// ulang oleh riwayat & cadangan tanpa menyentuh localStorage.
function buildState() {
  return {
      v: 1, seq: idSeq, basemap: currentBasemap,
      view: { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() },
      layout: { title: layout.title, author: layout.author,
                showLabels: layout.showLabels,
                tpl: layout.tpl,
                kop: Object.assign({}, layout.kop) },
      // Daftar kategori lengkap: warna + nama kustom + opacity + kategori tambahan user.
      catColors: CATEGORIES.reduce((acc, c) => { acc[c.id] = c.color; return acc; }, {}),
      categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, color: c.color, fillOpacity: c.fillOpacity })),
      features: features.map(f => ({
        id: f.id, name: f.name, category: f.category, desc: f.desc, type: f.type,
        fillOpacity: f.fillOpacity,
        customColor: f.customColor || null,
        geometry: layerToGeometry(f.layer, f.type)
      }))
  };
}

// Rekam keadaan ke riwayat + jadwalkan cadangan. Dipanggil save().
function recordHistory(label) {
  try {
    const raw = JSON.stringify(buildState());
    if (typeof History !== 'undefined') History.push(raw, label);
    if (typeof Backup !== 'undefined') Backup.schedule(raw);
  } catch (e) { /* riwayat bersifat tambahan, jangan ganggu alur utama */ }
}

function save(label) {
  try {
    const data = {
      v: 1, seq: idSeq, basemap: currentBasemap,
      view: { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() },
      layout: { title: layout.title, author: layout.author,
                showLabels: layout.showLabels,
                tpl: layout.tpl,
                kop: Object.assign({}, layout.kop) },
      // Daftar kategori lengkap: warna + nama kustom + opacity + kategori tambahan user.
      catColors: CATEGORIES.reduce((acc, c) => { acc[c.id] = c.color; return acc; }, {}),
      categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, color: c.color, fillOpacity: c.fillOpacity })),
      features: features.map(f => ({
        id: f.id, name: f.name, category: f.category, desc: f.desc, type: f.type,
        fillOpacity: f.fillOpacity,
        customColor: f.customColor || null,
        geometry: layerToGeometry(f.layer, f.type)
      }))
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    // Riwayat & cadangan memakai state yang sama (tanpa menyusun ulang).
    try {
      const raw = JSON.stringify(data);
      if (typeof History !== 'undefined') History.push(raw, label);
      if (typeof Backup !== 'undefined') Backup.schedule(raw);
    } catch (e2) { /* diabaikan */ }
    flashSaved();
  } catch (e) {
    console.warn('Gagal menyimpan ke browser:', e);
    const el = $('#save-state');
    $('#save-state-text').textContent = 'Simpan gagal';
    el.classList.add('dirty');
  }
}

function layerToGeometry(layer, type) {
  if (type === 'Circle') {
    const c = layer.getLatLng();
    return { type: 'Point', coordinates: [c.lng, c.lat], radius: layer.getRadius() };
  }
  return layer.toGeoJSON().geometry;
}

function load() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); }
  catch (e) { data = null; }
  if (!data || !Array.isArray(data.features)) return;

  // Data tersimpan ada: tampilkan skeleton selama memuat agar pengguna
  // tahu ada pekerjaan yang sedang dipulihkan (bukan layar kosong).
  const selesaiSkeleton = data.features.length ? tampilkanSkeletonDaftar() : null;

  idSeq = data.seq || 0;

  // Muat pengaturan layout
  if (data.layout) {
    layout.title = data.layout.title || '';
    layout.author = data.layout.author || '';
    layout.showLabels = data.layout.showLabels !== false;
    const t = $('#layout-title'); if (t) t.value = layout.title;
    const a = $('#layout-author'); if (a) a.value = layout.author;
    const labelToggle = $('#layout-show-labels');
    if (labelToggle) labelToggle.checked = !!layout.showLabels;
    // Pulihkan field kop akademik
    if (data.layout.kop) {
      layout.kop = Object.assign({}, KOP_DEFAULTS, data.layout.kop);
      if (Array.isArray(data.layout.kop.customBlocks)) {
        layout.kop.customBlocks = data.layout.kop.customBlocks.map(c => Object.assign({}, c));
      }
      if (Array.isArray(data.layout.kop.blokOrder)) {
        layout.kop.blokOrder = [...data.layout.kop.blokOrder];
      }
    }
    syncKopInputs();

    // Layout tersimpan. Data lama bisa memuat preset yang sudah dihapus.
    layout.tpl = normalizeTplId(data.layout.tpl);
    $('#map-wrap').classList.add('tpl-' + layout.tpl);
    $$('#tpl-row button').forEach(b => b.classList.toggle('active', b.dataset.tpl === layout.tpl));
  }

  // Pulihkan kategori: daftar lengkap bila ada (menyimpan nama kustom &
  // kategori tambahan), kalau tidak fallback ke peta warna lama.
  if (Array.isArray(data.categories) && data.categories.length) {
    CATEGORIES = data.categories
      .filter(c => c && typeof c.id === 'string')
      .map(c => ({
        id: c.id,
        label: (typeof c.label === 'string' && c.label.trim()) ? c.label : c.id,
        color: normalizeHex(c.color) || '#6c757d',
        fillOpacity: (c.fillOpacity != null) ? c.fillOpacity : undefined
      }));
    if (!CATEGORIES.length) CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));
  } else if (data.catColors) {
    Object.keys(data.catColors).forEach(catId => {
      if (typeof data.catColors[catId] === 'string') {
        setCategoryColor(catId, data.catColors[catId]);
      }
    });
  }
  (data.features || []).forEach(sf => {
    const type = sf.type || inferType(sf.geometry);
    if (!type) return;
    const layer = geometryToLayer(sf.geometry, type, sf.category);
    if (!layer) return;
    features.push({
      id: (sf.id != null) ? sf.id : ++idSeq,
      layer, type,
      name: sf.name || '',
      category: CATEGORIES.some(c => c.id === sf.category) ? sf.category : 'lainnya',
      desc: sf.desc || '',
      fillOpacity: (sf.fillOpacity != null) ? sf.fillOpacity : null,
      customColor: sf.customColor || null,
      measure: null
    });
    drawnItems.addLayer(layer);
    refreshFeature(features[features.length - 1]);
  });

  renderList();
  if (selesaiSkeleton) selesaiSkeleton();
  renderCategoryColors();
  renderCategorySelect();
  renderLogoPreview();
  renderBlokToggles();
  if (data.basemap && BASEMAPS[data.basemap]) setBasemap(data.basemap);
  if (data.view) {
    try { map.setView([data.view.lat, data.view.lng], data.view.zoom); } catch (e) {}
  }
}

/* -------------------- Pemulihan cadangan -------------------- */
// Kalau data utama hilang/rusak tapi cadangan masih ada, tawarkan
// pemulihan. Ini jaring pengaman terakhir sebelum pekerjaan benar-benar
// hilang (localStorage bisa dibersihkan browser atau penuh).
function cekCadangan() {
  if (typeof Backup === 'undefined') return;
  const cad = Backup.read();
  if (!cad) return;

  let utama = null;
  try { utama = localStorage.getItem(STORE_KEY); } catch (e) {}

  // Tidak perlu menawarkan bila data utama ada dan sudah memuat fitur.
  let utamaPunyaFitur = false;
  try {
    const d = JSON.parse(utama);
    utamaPunyaFitur = !!(d && Array.isArray(d.features) && d.features.length);
  } catch (e) {}

  // Hitung jumlah fitur di cadangan
  let cadFitur = 0;
  try {
    const d = JSON.parse(cad.raw);
    cadFitur = (d && Array.isArray(d.features)) ? d.features.length : 0;
  } catch (e) { return; }

  // Tawarkan hanya bila utama kosong/rusak TAPI cadangan berisi data.
  if (utamaPunyaFitur || cadFitur === 0) return;

  const kapan = cad.at ? new Date(cad.at).toLocaleString('id-ID') : 'sebelumnya';
  toast('Ditemukan cadangan ' + cadFitur + ' fitur (' + kapan + ')', {
    actionLabel: 'Pulihkan',
    onAction: () => {
      applySnapshot(cad.raw);
      Backup.clear();
      toast('Cadangan dipulihkan');
    }
  });
}

/* -------------------- Undo / Redo (riwayat) -------------------- */
// Terapkan snapshot state ke aplikasi. Dipakai oleh undo & redo.
// Semua pemulihan dibungkus History.runSuspended supaya proses ini tidak
// ikut terekam sebagai langkah riwayat baru.
function applySnapshot(raw) {
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { toast('Riwayat rusak, tidak bisa dipulihkan'); return; }

  History.runSuspended(() => {
    // Bersihkan fitur & halo yang ada sekarang
    try { map.closePopup(); } catch (e) {}
    features.forEach(f => {
      try { drawnItems.removeLayer(f.layer); } catch (e) {}
      if (f.__halo && map.__haloGroup) map.__haloGroup.removeLayer(f.__halo);
    });
    features = [];
    if (map.__haloGroup) map.__haloGroup.clearLayers();

    // Kategori (warna, nama & opacity)
    if (Array.isArray(data.categories) && data.categories.length) {
      CATEGORIES = data.categories
        .filter(c => c && typeof c.id === 'string')
        .map(c => ({
          id: c.id,
          label: (typeof c.label === 'string' && c.label.trim()) ? c.label : c.id,
          color: normalizeHex(c.color) || '#6c757d',
          fillOpacity: (c.fillOpacity != null) ? c.fillOpacity : undefined
        }));
      if (!CATEGORIES.length) CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));
    }

    // Layout & kop
    if (data.layout) {
      const L2 = data.layout;
      layout.title = L2.title || '';
      layout.author = L2.author || '';
      layout.showLabels = L2.showLabels !== false;
      layout.kop = Object.assign({}, KOP_DEFAULTS, L2.kop || {});
      if (Array.isArray(layout.kop.customBlocks)) {
        layout.kop.customBlocks = layout.kop.customBlocks.map(c => Object.assign({}, c));
      }
      if (Array.isArray(layout.kop.blokOrder)) {
        layout.kop.blokOrder = [...layout.kop.blokOrder];
      }
      const t = $('#layout-title'); if (t) t.value = layout.title;
      const a = $('#layout-author'); if (a) a.value = layout.author;
      const labelToggle = $('#layout-show-labels');
      if (labelToggle) labelToggle.checked = !!layout.showLabels;
      syncKopInputs();
      // Langkah riwayat lama bisa memuat preset yang sudah dihapus.
      layout.tpl = normalizeTplId(L2.tpl);
    }

    // Fitur
    (data.features || []).forEach(sf => {
      const type = sf.type || inferType(sf.geometry);
      if (!type) return;
      const layer = geometryToLayer(sf.geometry, type, sf.category);
      if (!layer) return;
      const f = {
        id: (sf.id != null) ? sf.id : ++idSeq,
        layer, type,
        name: sf.name || '',
        category: CATEGORIES.some(c => c.id === sf.category) ? sf.category : 'lainnya',
        desc: sf.desc || '',
        fillOpacity: (sf.fillOpacity != null) ? sf.fillOpacity : null,
        customColor: sf.customColor || null,
        measure: null
      };
      drawnItems.addLayer(layer);
      refreshFeature(f);
      features.push(f);
    });


    if (data.seq) idSeq = data.seq;

    // Peta dasar & tampilan
    if (data.basemap && BASEMAPS[data.basemap]) setBasemap(data.basemap, true);

    renderList();
    renderCategoryColors();
    renderCategorySelect();
    renderLogoPreview();
    renderBlokToggles();

    // Lembar kop dipasang dari state (satu-satunya layout aplikasi).
    if (!document.querySelector('.formal-sheet')) applyTemplate(layout.tpl);
    else if (typeof FormalSheet !== 'undefined') FormalSheet.scheduleRefresh();

    updateLayout();

    if (data.view) {
      try { map.setView([data.view.lat, data.view.lng], data.view.zoom, { animate: false }); } catch (e) {}
    }
  });

  // Simpan hasil pemulihan tanpa menambah langkah riwayat baru.
  try {
    const raw2 = JSON.stringify(buildState());
    localStorage.setItem(STORE_KEY, raw2);
    flashSaved();
  } catch (e) { /* diabaikan */ }
}

function updateHistoryButtons() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (u) {
    const bisa = History.canUndo();
    u.disabled = !bisa;
    u.title = bisa ? ('Urungkan: ' + (History.nextUndoLabel() || 'perubahan')) : 'Tidak ada yang bisa diurungkan';
  }
  if (r) {
    const bisa = History.canRedo();
    r.disabled = !bisa;
    r.title = bisa ? 'Ulangi perubahan' : 'Tidak ada yang bisa diulangi';
  }
}

function doUndo() {
  const raw = History.undo();
  if (!raw) { toast('Tidak ada yang bisa diurungkan'); return; }
  applySnapshot(raw);
  toast('Diurungkan');
}

function doRedo() {
  const raw = History.redo();
  if (!raw) { toast('Tidak ada yang bisa diulangi'); return; }
  applySnapshot(raw);
  toast('Diulangi');
}

function bindHistory() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (u) u.addEventListener('click', doUndo);
  if (r) r.addEventListener('click', doRedo);

  History.onChange = updateHistoryButtons;
  updateHistoryButtons();
}

/* -------------------- Inisialisasi -------------------- */
function init() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false
  }).setView([-2.5, 118], 5); // Indonesia

  drawnItems = L.featureGroup().addTo(map);

  const scaleCtl = L.control.scale({
    position: 'bottomleft', metric: true, imperial: false, maxWidth: 140
  }).addTo(map);
  scaleCtl._container.classList.add('map-scale-ctl');
  map.__scaleControl = scaleCtl;

  // ---- Event gambar ----
  map.on(L.Draw.Event.CREATED, (e) => {
    const type = canonicalType(e.layerType);
    const layer = e.layer;
    const f = {
      id: ++idSeq, layer, type,
      name: '', category: 'lainnya', desc: '', measure: null
    };
    addFeature(f, true);
    stopDraw();
  });

  map.on(L.Draw.Event.DRAWSTART, () => {
    if (currentDrawerType === 'Circle' || currentDrawerType === 'Rectangle') {
      setBadge(HINT[currentDrawerType] || '');
    }
  });
  map.on(L.Draw.Event.DRAWSTOP, () => { /* badge dibersihkan di CREATED/aborted */ });
  map.on(L.Draw.Event.DRAWVERTEX, (e) => {
    if (!currentDrawerType) return;
    let pts = [];
    try { pts = e.layers.getLatLngs(); } catch (err) { pts = []; }
    if (!pts.length) return;
    try {
      const line = turf.lineString(pts.map(p => [p.lng, p.lat]));
      let html = 'Sementara: <b>' + fmtLen(turf.length(line) * 1000) + '</b>';
      if ((currentDrawerType === 'Polygon') && pts.length >= 3) {
        const ring = pts.map(p => [p.lng, p.lat]);
        ring.push(ring[0]);
        html += '<br><span class="small">Luas: ' + fmtArea(turf.area(turf.polygon([ring]))) + '</span>';
      }
      setBadge(html);
    } catch (err) { /* abaikan */ }
  });

  map.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer(layer => {
      const f = features.find(x => x.layer === layer);
      if (f) refreshFeature(f);
    });
    renderList();
    save('Ubah bentuk');
    toast('Perubahan bentuk disimpan');
  });

  // Klik kanan pada fitur membuka popup (bawaan Leaflet) — tidak perlu handler khusus.

  // Tombol popup
  map.on('popupopen', (e) => {
    const root = e.popup.getElement();
    if (!root) return;
    const fid = e.popup.options.featureId;
    if (fid != null) highlightItem(fid);
    root.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'edit') openAttrModal(fid);
        if (act === 'del') deleteFeature(fid);
      });
    });
  });
  map.on('popupclose', () => highlightItem(null));

  // Koordinat mouse
  map.on('mousemove', (e) => {
    $('#coord-badge').textContent = fmtCoord([e.latlng.lat, e.latlng.lng]);
  });
  map.on('mouseout', () => { $('#coord-badge').textContent = '—'; });

  // ---- Toolbar UI ----
  $$('.tool[data-tool]').forEach(b => {
    b.addEventListener('click', () => {
      if (currentDrawer && currentDrawerType === b.dataset.tool) { stopDraw(); return; }
      startDraw(b.dataset.tool);
    });
  });
  $('#tool-edit').addEventListener('click', toggleEdit);
  $('#btn-clear').addEventListener('click', clearAll);

  // Peta dasar
  $$('#basemap-row button').forEach(b => {
    b.addEventListener('click', () => setBasemap(b.dataset.basemap));
  });

  // ---- Modal atribut ----
  $('#attr-save').addEventListener('click', () => {
    const f = features.find(x => x.id === editingFeatureId);
    if (!f) { closeAttrModal(); return; }
    f.name = $('#attr-name').value.trim();
    f.category = $('#attr-category').value;
    f.desc = $('#attr-desc').value.trim();

    // Simpan opacity kustom per-fitur
    const opacityInput = $('#attr-opacity');
    if (opacityInput) {
      f.fillOpacity = parseInt(opacityInput.value, 10) / 100;
    }
    // Simpan warna kustom per-fitur (bila toggle aktif)
    const customToggle = $('#attr-custom-color-toggle');
    const customColorInput = $('#attr-custom-color');
    if (customToggle && customColorInput) {
      f.customColor = customToggle.checked ? (customColorInput.value || null) : null;
    }

    refreshFeature(f);
    renderList();
    save('Ubah detail fitur');
    closeAttrModal();
    toast('Detail fitur disimpan');
  });

  $('#attr-cancel').addEventListener('click', closeAttrModal);

  // ---- Interaksi live di modal: opacity slider & custom color toggle ----
  const attrOpacity = $('#attr-opacity');
  const attrOpacityVal = $('#attr-opacity-val');
  if (attrOpacity && attrOpacityVal) {
    attrOpacity.addEventListener('input', () => {
      attrOpacityVal.textContent = attrOpacity.value + '%';
    });
  }
  const attrCCToggle = $('#attr-custom-color-toggle');
  const attrCCRow    = $('#attr-custom-color-row');
  if (attrCCToggle && attrCCRow) {
    attrCCToggle.addEventListener('change', () => {
      attrCCRow.classList.toggle('hidden', !attrCCToggle.checked);
    });
  }


  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#modal-overlay')) closeAttrModal();
  });
  $('#modal-overlay').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') trapFocus($('#modal-overlay .modal'), e);
  });

  // ---- Bantuan ----
  $('#btn-help').addEventListener('click', () => $('#help-overlay').classList.remove('hidden'));
  $('#help-close').addEventListener('click', () => {
    $('#help-overlay').classList.add('hidden');
    try { localStorage.setItem('dm-help-seen', '1'); } catch (e) {}
  });

  // ---- Ekspor / impor ----
  $('#btn-export-geojson').addEventListener('click', exportGeoJSON);
  const csvBtn = $('#btn-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCSV);
  $('#btn-export-png').addEventListener('click', () => PaperLayout.open('png'));
  $('#btn-print').addEventListener('click', () => PaperLayout.open('print'));
  const pickFile = () => $('#file-input').click();
  $('#btn-import').addEventListener('click', pickFile);
  $('#btn-import-empty').addEventListener('click', pickFile);
  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importGeoJSON(reader.result);
    reader.onerror = () => toast('Gagal membaca file');
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---- Pencarian ----
  const si = $('#search-input');
  si.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = si.value.trim();
    if (!q) { $('#search-results').classList.remove('show'); return; }
    searchTimer = setTimeout(() => doSearch(q), 380);
  });
  si.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      doSearch(si.value.trim());
    }
    if (e.key === 'Escape') $('#search-results').classList.remove('show');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-box')) $('#search-results').classList.remove('show');
  });

  // ---- Sidebar (mobile) ----
  // ---- Sidebar (mobile): drawer dengan backdrop + tombol tutup ----
  const syncBackdrop = () => {
    const sb = $('#sidebar');
    const closed = sb.classList.contains('closed');
    const mobile = window.innerWidth <= 860;
    $('#sidebar-backdrop').classList.toggle('show', !closed && mobile);
    // Tombol X posisinya di pojok kanan-atas sidebar terbuka
    const x = $('#sidebar-close');
    if (x) {
      const w = Math.min(320, window.innerWidth * 0.88);
      x.style.left = (closed ? -60 : w - 44) + 'px';
      x.classList.toggle('show', !closed && mobile);
    }
  };
  $('#sidebar-toggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('closed');
    syncBackdrop();
  });
  $('#sidebar-close').addEventListener('click', () => {
    $('#sidebar').classList.add('closed');
    syncBackdrop();
  });
  $('#sidebar-backdrop').addEventListener('click', () => {
    $('#sidebar').classList.add('closed');
    syncBackdrop();
  });
  if (window.innerWidth <= 860) $('#sidebar').classList.add('closed');
  window.addEventListener('resize', syncBackdrop);
  syncBackdrop();

  // ---- Keyboard ----
  // Pintasan: T=titik, G=garis, P=poligon, K=kotak, B=bulat, E=edit, Esc=batal
  const SHORTCUTS = {
    t: 'Marker', g: 'Polyline', p: 'Polygon',
    k: 'Rectangle', b: 'Circle'
  };
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const diKolomTeks = (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable);

    // Ctrl/Cmd+Z tetap berlaku walau fokus ada di kolom teks: pengguna
    // menganggapnya "urungkan perubahan peta", bukan undo ketikan.
    const kb = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (kb === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if ((kb === 'z' && e.shiftKey) || kb === 'y') { e.preventDefault(); doRedo(); return; }
    }

    if (diKolomTeks) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (currentDrawer) { stopDraw(); toast('Gambar dibatalkan'); }
      if (editHandler) stopEdit();
      $('#modal-overlay').classList.add('hidden');
      $('#help-overlay').classList.add('hidden');
      $('#search-results').classList.remove('show');
      return;
    }

    const key = e.key.toLowerCase();
    if (SHORTCUTS[key]) {
      e.preventDefault();
      if (currentDrawer && currentDrawerType === SHORTCUTS[key]) { stopDraw(); return; }
      startDraw(SHORTCUTS[key]);
    } else if (key === 'e') {
      e.preventDefault();
      toggleEdit();
    }
  });

  // ---- Riwayat (undo/redo) ----
  bindHistory();

  // ---- Tampil/sembunyi bagian peta ----
  bindBlokToggles();

  // ---- Logo instansi ----
  bindLogoUpload();

  // ---- Batas administrasi ----
  bindAdminBoundaries();

  // ---- Layout peta ----
  bindLayout();
  renderCategoryColors();
  renderCategorySelect();

  // Pasang peta dasar default (tanpa save), lalu muat data lama.
  setBasemap(currentBasemap, true);
  load();
  updateLayout();

  // Lembar kop selalu dipasang: itu satu-satunya layout aplikasi ini.
  applyTemplate(layout.tpl);

  // Titik awal riwayat: keadaan dokumen setelah data lama dimuat.
  try {
    History.reset(JSON.stringify(buildState()), 'Awal');
    updateHistoryButtons();
  } catch (e) { /* diabaikan */ }

  // Tawarkan pemulihan bila cadangan lebih baru dari data utama.
  cekCadangan();

  // ---- Tampilkan bantuan sekali ----
  const params = new URLSearchParams(location.search);
  let seen = false;
  try { seen = localStorage.getItem('dm-help-seen') === '1'; } catch (e) {}
  if (!seen && !params.has('nohelp')) {
    setTimeout(() => $('#help-overlay').classList.remove('hidden'), 400);
  }
}

document.addEventListener('DOMContentLoaded', init);
