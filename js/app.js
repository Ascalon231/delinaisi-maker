/* ============================================================
   Delinaisi Maker — app.js
   Web sederhana untuk membuat peta delinasi.
   ============================================================ */

'use strict';

/* -------------------- Konstanta -------------------- */
const STORE_KEY = 'delinaisi-maker-v1';

// Jenis delinasi yang bisa dipilih, lengkap dengan warna peta.
const CATEGORIES = [
  { id: 'batas_admin',      label: 'Batas Administrasi',      color: '#e63946' },
  { id: 'daerah_pemilihan', label: 'Daerah Pemilihan',        color: '#7b2cbf' },
  { id: 'wilayah_studi',    label: 'Wilayah Studi',           color: '#2a9d8f' },
  { id: 'zona_rawan',       label: 'Zona Rawan Bencana',      color: '#e76f51' },
  { id: 'penggunaan_lahan', label: 'Penggunaan Lahan',        color: '#588157' },
  { id: 'jaringan_jalan',   label: 'Jaringan / Jalan',        color: '#457b9d' },
  { id: 'perairan',         label: 'Perairan / Sungai',       color: '#0096c7' },
  { id: 'lainnya',          label: 'Lainnya',                 color: '#6c757d' }
];

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
function fmtCoord(c) { return c[0].toFixed(5) + '°, ' + c[1].toFixed(5) + '°'; }

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
function styleFor(type, color) {
  if (type === 'Polyline') return { color, weight: 3, opacity: .95, lineJoin: 'round' };
  if (type === 'Marker')   return {};
  return { color, weight: 2.5, opacity: .95, fillColor: color, fillOpacity: .22, lineJoin: 'round' };
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

function applyStyle(f) {
  const color = catOf(f.category).color;
  if (f.type === 'Marker') {
    if (f.layer.setIcon) f.layer.setIcon(markerIcon(color));
  } else if (f.layer.setStyle) {
    f.layer.setStyle(styleFor(f.type, color));
  }
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
      '<button class="btn btn-secondary btn-sm" data-act="edit">Edit</button>' +
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
  updateLegend();

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
  save();
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
  features.splice(i, 1);
  renderList();
  save();
  // Tawarkan urungkan penghapusan (safety net, sangat penting untuk mahasiswa!).
  toast('Fitur "' + (removed.name || 'tanpa nama') + '" dihapus', {
    actionLabel: 'Urungkan',
    onAction: () => {
      if (features.some(f => f.id === removed.id)) return;
      features.push(removed);
      drawnItems.addLayer(removed.layer);
      renderList();
      save();
      toast('Fitur dipulihkan');
    }
  });
}

function clearAll() {
  if (!features.length) { toast('Tidak ada fitur untuk dihapus'); return; }
  if (!confirm('Hapus semua ' + features.length + ' fitur dari peta? Tindakan ini tidak bisa dibatalkan.')) return;
  map.closePopup();
  const backup = features.slice();
  features.forEach(f => drawnItems.removeLayer(f.layer));
  features = [];
  renderList();
  save();
  toast('Semua fitur dihapus', {
    actionLabel: 'Urungkan',
    onAction: () => {
      features = backup;
      features.forEach(f => drawnItems.addLayer(f.layer));
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
}

function stopDraw() {
  if (currentDrawer) {
    try { currentDrawer.disable(); } catch (e) {}
    currentDrawer = null;
    currentDrawerType = null;
  }
  setBadge('');

  $$('.tool[data-tool]').forEach(b => b.classList.remove('active'));
  $('#draw-hint').textContent =
    'Pilih salah satu alat di atas, lalu klik di peta untuk mulai menggambar. Klik dua kali (atau Enter) untuk selesaikan poligon/garis.';
  try { delete window.__drawer; } catch (e) { window.__drawer = undefined; }
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
  toast('Klik & tarik sudut fitur untuk mengedit');
}
function stopEdit() {
  if (!editHandler) return;
  try { editHandler.disable(); } catch (e) {}
  editHandler = null;
  $('#tool-edit').classList.remove('active');
  setBadge('');
}

/* -------------------- Modal atribut -------------------- */
function openAttrModal(id, isNew) {
  const f = features.find(x => x.id === id);
  if (!f) return;
  editingFeatureId = id;

  const sel = $('#attr-category');
  if (sel.options.length === 0) {
    CATEGORIES.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.label;
      sel.appendChild(o);
    });
  }
  sel.value = CATEGORIES.some(c => c.id === f.category) ? f.category : 'lainnya';

  $('#attr-name').value = f.name || '';
  $('#attr-desc').value = f.desc || '';
  $('#attr-measure').innerHTML = measureRows(f).map(r =>
    '<div class="row"><span class="label">' + esc(r.label) + '</span><span class="val">' + esc(r.value) + '</span></div>'
  ).join('') || '<div class="row"><span class="val">—</span></div>';

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
const BASEMAPS = {
  streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true,
    attribution: '© kontributor OpenStreetMap'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true,
    attribution: '© Esri, Maxar, Earthstar Geographics'
  }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', crossOrigin: true,
    attribution: '© OpenStreetMap, © CARTO'
  })
};

function setBasemap(id, skipSave) {
  if (!BASEMAPS[id]) return;
  if (BASEMAPS[currentBasemap]) map.removeLayer(BASEMAPS[currentBasemap]);
  currentBasemap = id;
  map.addLayer(BASEMAPS[id]);
  BASEMAPS[id].bringToBack();
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
  if (!skipSave) save();
}

/* -------------------- Layout peta (judul, legenda, utara, kredit) ---------- */
const layout = {
  title: '', author: '',
  showLegend: true, showNorth: true, showScale: true, showCredit: true,
  tpl: 'klasik'
};

// Template layout mengikuti konvensi QGIS/ArcGIS:
// - klasik: judul tengah-atas, elemen menyebar (default QGIS)
// - rapat:  semua elemen di sisi kanan (gaya ArcGIS minimal)
// - modal:  judul di tengah-bawah (gaya peta akademik modern)
// - bersih: hanya judul + legenda + skala
const TEMPLATES = {
  klasik: { showLegend: true,  showNorth: true,  showScale: true,  showCredit: true  },
  rapat:  { showLegend: true,  showNorth: true,  showScale: true,  showCredit: true  },
  modal:  { showLegend: true,  showNorth: true,  showScale: true,  showCredit: true  },
  bersih: { showLegend: true,  showNorth: false, showScale: true,  showCredit: false }
};

function applyTemplate(id) {
  if (!TEMPLATES[id]) return;
  layout.tpl = id;
  const t = TEMPLATES[id];
  layout.showLegend = t.showLegend;
  layout.showNorth = t.showNorth;
  layout.showScale = t.showScale;
  layout.showCredit = t.showCredit;

  $('#map-wrap').className = 'tpl-' + id + (layout.title.trim() ? ' has-title' : '');
  $$('#tpl-row button').forEach(b => b.classList.toggle('active', b.dataset.tpl === id));

  // Sinkronkan checkbox di panel
  const map = { showLegend: '#layout-show-legend', showNorth: '#layout-show-north',
                showScale: '#layout-show-scale', showCredit: '#layout-show-credit' };
  Object.keys(map).forEach(k => { if ($(map[k])) $(map[k]).checked = !!layout[k]; });

  updateLayout();
  save();
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
                'Juli','Agustus','September','Oktober','November','Desember'];

function formatDateID(d) {
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// Sumber data per peta dasar (untuk kotak kredit & ekspor).
function basemapAttribution(id) {
  const m = {
    streets: 'OpenStreetMap & kontributornya',
    satellite: 'Esri, Maxar, Earthstar Geographics',
    light: 'OpenStreetMap & CARTO'
  };
  return m[id] || 'OpenStreetMap';
}

function updateLegend() {  const legendEl = $('#map-legend');
  if (!legendEl) return;
  const listEl = $('#map-legend-list');
  listEl.innerHTML = '';

  // Hitung kategori yang terpakai, beserta jenis geometri dominannya.
  const used = {};
  features.forEach(f => {
    if (!used[f.category]) used[f.category] = { points: 0, lines: 0, polys: 0 };
    if (f.type === 'Marker') used[f.category].points++;
    else if (f.type === 'Polyline') used[f.category].lines++;
    else used[f.category].polys++;
  });

  Object.keys(used).forEach(catId => {
    const cat = catOf(catId);
    const u = used[catId];
    const total = u.points + u.lines + u.polys;
    let shape = 'poly', label = cat.label;
    if (u.polys === 0 && u.lines === 0) shape = 'dot';
    else if (u.polys === 0 && u.points === 0) shape = 'line';

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML =
      '<span class="legend-swatch ' + shape + '" style="' +
        (shape === 'line' ? 'border-color:' + cat.color : 'background:' + cat.color) +
      '"></span>' +
      '<span class="legend-label">' + esc(label) + '</span>' +
      '<span class="legend-count">' + total + '</span>';
    listEl.appendChild(item);
  });

  if (!listEl.children.length) {
    listEl.innerHTML = '<div class="legend-empty">Belum ada fitur.</div>';
  }
  legendEl.classList.toggle('hidden', !layout.showLegend);
}

function updateLayout() {
  // Judul
  const titleEl = $('#map-title');
  titleEl.textContent = layout.title;
  const hasTitle = !!layout.title.trim();
  titleEl.classList.toggle('hidden', !hasTitle);
  // Saat judul tampil, kotak pencarian digeser ke bawah (lihat css/style.css).
  // Pertahankan class template (tpl-*).
  const wrap = $('#map-wrap');
  wrap.classList.toggle('has-title', hasTitle);
  if (!wrap.className.match(/tpl-\w+/)) wrap.classList.add('tpl-' + (layout.tpl || 'klasik'));

  // Kredit (nama, tanggal, sumber data, sistem koordinat)
  const creditEl = $('#map-credit');
  const hasAuthor = !!layout.author.trim();
  $('#map-credit-author').textContent = hasAuthor ? 'Dibuat oleh: ' + layout.author.trim() : '';
  $('#map-credit-date').textContent = 'Tanggal: ' + formatDateID(new Date());
  $('#map-credit-source').textContent = 'Sumber data: ' + basemapAttribution(currentBasemap);
  $('#map-credit-crs').textContent = 'Sistem koordinat: WGS 84 (EPSG:4326)';
  creditEl.classList.toggle('hidden', !layout.showCredit || !hasAuthor);

  // Legenda
  updateLegend();

  // Arah utara
  $('#map-north').classList.toggle('hidden', !layout.showNorth);

  // Skala: pakai kontrol bawaan Leaflet, toggle tampil
  const scaleCtl = map.__scaleControl;
  if (scaleCtl) {
    const el = scaleCtl.getContainer();
    if (el) el.style.display = layout.showScale ? '' : 'none';
  }
}

function bindLayout() {
  $('#layout-title').addEventListener('input', (e) => {
    layout.title = e.target.value;
    updateLayout();
    save();
  });
  $('#layout-author').addEventListener('input', (e) => {
    layout.author = e.target.value;
    updateLayout();
    save();
  });
  const toggles = [
    ['#layout-show-legend', 'showLegend'],
    ['#layout-show-north', 'showNorth'],
    ['#layout-show-scale', 'showScale'],
    ['#layout-show-credit', 'showCredit']
  ];
  toggles.forEach(([sel, key]) => {
    $(sel).addEventListener('change', (e) => {
      layout[key] = e.target.checked;
      updateLayout();
      save();
    });
  });

  // Pemilih template layout
  $$('#tpl-row button').forEach(b => {
    b.addEventListener('click', () => applyTemplate(b.dataset.tpl));
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

function inferType(g) {
  if (!g || !g.type) return null;
  if (g.type === 'Point') return (g.radius != null) ? 'Circle' : 'Marker';
  if (g.type === 'LineString' || g.type === 'MultiLineString') return 'Polyline';
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return 'Polygon';
  return null;
}

function importGeoJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { toast('File GeoJSON tidak valid'); return; }

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
      name: String(p.name || p.Nama || '').slice(0, 80),
      category,
      desc: String(p.description || p.desc || p.keterangan || '').slice(0, 400),
      measure: null
    }, false);
    n++;
  });

  save();
  if (n) {
    toast(n + ' fitur berhasil diimpor');
    map.fitBounds(drawnItems.getBounds(), { padding: [40, 40], maxZoom: 16 });
  } else {
    toast('Tidak ada geometri yang bisa dibaca');
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

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
}

function exportPNG() {
  if (typeof html2canvas === 'undefined') { toast('Pustaka gambar belum termuat'); return; }

  // Target: seluruh area peta termasuk elemen layout (judul, legenda, dst).
  const target = $('#map-wrap');
  const hideDuringExport = ['#search-box', '#coord-badge', '#measure-badge', '.leaflet-control-zoom'];
  const hidden = [];
  hideDuringExport.forEach(sel => {
    const el = $(sel);
    if (el && el.style.display !== 'none') { el.style.display = 'none'; hidden.push(el); }
  });
  toast('Membuat gambar peta…');

  html2canvas(target, {
    useCORS: true, allowTaint: false, logging: false,
    backgroundColor: '#dfe7ef',
    windowWidth: target.offsetWidth,
    windowHeight: target.offsetHeight
  }).then(canvas => {
    hidden.forEach(el => { el.style.display = ''; });
    canvas.toBlob(blob => {
      downloadBlob(blob, 'peta-delinasi.png');
      toast('Gambar PNG tersimpan');
    }, 'image/png');
  }).catch(err => {
    hidden.forEach(el => { el.style.display = ''; });
    console.error(err);
    toast('Gagal membuat gambar: ' + (err.message || err));
  });
}

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

function save() {
  try {
    const data = {
      v: 1, seq: idSeq, basemap: currentBasemap,
      view: { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() },
      layout: { title: layout.title, author: layout.author,
                showLegend: layout.showLegend, showNorth: layout.showNorth,
                showScale: layout.showScale, showCredit: layout.showCredit,
                tpl: layout.tpl },
      features: features.map(f => ({
        id: f.id, name: f.name, category: f.category, desc: f.desc, type: f.type,
        geometry: layerToGeometry(f.layer, f.type)
      }))
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
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

  idSeq = data.seq || 0;

  // Muat pengaturan layout
  if (data.layout) {
    layout.title = data.layout.title || '';
    layout.author = data.layout.author || '';
    layout.showLegend = data.layout.showLegend !== false;
    layout.showNorth = data.layout.showNorth !== false;
    layout.showScale = data.layout.showScale !== false;
    layout.showCredit = data.layout.showCredit !== false;
    const t = $('#layout-title'); if (t) t.value = layout.title;
    const a = $('#layout-author'); if (a) a.value = layout.author;
    const tg = {
      showLegend: '#layout-show-legend', showNorth: '#layout-show-north',
      showScale: '#layout-show-scale', showCredit: '#layout-show-credit'
    };
    Object.keys(tg).forEach(k => {
      const el = $(tg[k]); if (el) el.checked = !!layout[k];
    });
    // Terapkan template layout yang tersimpan
    if (data.layout.tpl && TEMPLATES[data.layout.tpl]) {
      layout.tpl = data.layout.tpl;
      $('#map-wrap').classList.add('tpl-' + layout.tpl);
      $$('#tpl-row button').forEach(b => b.classList.toggle('active', b.dataset.tpl === layout.tpl));
    }
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
      measure: null
    });
    drawnItems.addLayer(layer);
    refreshFeature(features[features.length - 1]);
  });

  renderList();
  if (data.basemap && BASEMAPS[data.basemap]) setBasemap(data.basemap);
  if (data.view) {
    try { map.setView([data.view.lat, data.view.lng], data.view.zoom); } catch (e) {}
  }
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
    save();
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
    $('#coord-badge').textContent = e.latlng.lat.toFixed(5) + '°, ' + e.latlng.lng.toFixed(5) + '°';
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
    refreshFeature(f);
    renderList();
    save();
    closeAttrModal();
    toast('Detail fitur disimpan');
  });
  $('#attr-cancel').addEventListener('click', closeAttrModal);
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
  $('#btn-export-png').addEventListener('click', exportPNG);
  $('#btn-print').addEventListener('click', () => window.print());
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
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    // jangan ganggu saat modifikasi teks di contenteditable
    if (e.metaKey || e.ctrlKey || e.altKey) return;

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

  // ---- Layout peta ----
  bindLayout();

  // Pasang peta dasar default (tanpa save), lalu muat data lama.
  setBasemap(currentBasemap, true);
  load();
  updateLayout();

  // ---- Tampilkan bantuan sekali ----
  const params = new URLSearchParams(location.search);
  let seen = false;
  try { seen = localStorage.getItem('dm-help-seen') === '1'; } catch (e) {}
  if (!seen && !params.has('nohelp')) {
    setTimeout(() => $('#help-overlay').classList.remove('hidden'), 400);
  }
}

document.addEventListener('DOMContentLoaded', init);
