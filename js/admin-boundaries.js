/* ============================================================
   Delinaisi Maker — admin-boundaries.js
   Lapisan batas administrasi, TERPISAH dari delinasi user.

   Sumber: Nominatim (OpenStreetMap) — gratis & tanpa API key.

   Kepatuhan pada Nominatim Usage Policy
   (https://operations.osmfoundation.org/policies/nominatim/):
     - Maksimum 1 permintaan/detik -> semua permintaan lewat antrean
       yang menjamin jeda minimal 1,1 detik.
     - DILARANG autocomplete -> pencarian hanya dijalankan saat user
       menekan tombol, bukan saat mengetik.
     - Hasil wajib di-cache -> disimpan di memori + localStorage,
       sehingga kueri yang sama tidak diulang.
     - Atribusi OSM ditampilkan di UI.
   ============================================================ */

'use strict';

const AdminBoundaries = (function () {

  const CACHE_KEY = 'delinaisi-admin-cache-v1';
  const CACHE_TTL = 1000 * 60 * 60 * 24 * 14;  // 14 hari

  let layerGroup = null;     // L.geoJSON untuk batas yang dimuat
  let lastResult = null;     // hasil terakhir yang ditampilkan
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  /* -------------------- Cache -------------------- */
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (e) { return {}; }
  }

  function writeCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      // Kuota penuh: buang entri lama lalu coba sekali lagi.
      try {
        const keys = Object.keys(cache);
        if (keys.length > 3) {
          keys.slice(0, Math.floor(keys.length / 2)).forEach(k => delete cache[k]);
          localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        }
      } catch (e2) { /* menyerah dengan tenang */ }
    }
  }

  function cacheGet(key) {
    const c = readCache()[key];
    if (!c) return null;
    if (Date.now() - (c.t || 0) > CACHE_TTL) return null;
    return c.v || null;
  }

  function cacheSet(key, value) {
    const cache = readCache();
    cache[key] = { t: Date.now(), v: value };
    writeCache(cache);
  }

  /* -------------------- Antrean 1 permintaan/detik -------------------- */
  function throttle(fn) {
    queue = queue.then(() => {
      const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
      return new Promise(res => setTimeout(res, wait)).then(() => {
        lastRequestAt = Date.now();
        return fn();
      });
    }).catch(() => { /* error ditangani pemanggil */ });
    return queue;
  }

  /* -------------------- Klasifikasi tingkat -------------------- */
  // place_rank OSM: 8 provinsi, 10-12 kabupaten/kota, 14-16 kecamatan,
  // 17+ kelurahan/desa. Dipakai untuk menandai & memfilter hasil.
  function levelOf(rank) {
    const r = Number(rank);
    if (!isFinite(r)) return { id: 'other', label: 'Lainnya' };
    if (r <= 8) return { id: 'province', label: 'Provinsi' };
    if (r <= 12) return { id: 'regency', label: 'Kabupaten/Kota' };
    if (r <= 16) return { id: 'district', label: 'Kecamatan' };
    return { id: 'village', label: 'Kelurahan/Desa' };
  }

  function countPoints(geom) {
    if (!geom) return 0;
    if (geom.type === 'Polygon') return geom.coordinates[0].length;
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.reduce((n, poly) => n + poly[0].length, 0);
    }
    return 0;
  }

  // Hanya terima batas administratif sungguhan. Ini menolak jebakan umum:
  // kueri "Kecamatan Cibinong" bisa mengembalikan "Kantor Kecamatan"
  // (sebuah bangunan dengan 5 titik).
  function isRealBoundary(r) {
    if (!r || !r.geojson) return false;
    if (r.category !== 'boundary') return false;
    if (r.type !== 'administrative') return false;
    const g = r.geojson.type;
    if (g !== 'Polygon' && g !== 'MultiPolygon') return false;
    return countPoints(r.geojson) >= 20;
  }

  /* -------------------- Pencarian -------------------- */
  function search(query, level) {
    const key = 'q:' + query.trim().toLowerCase() + '|' + (level || 'any');
    const cached = cacheGet(key);
    if (cached) {
      return Promise.resolve({ results: cached, fromCache: true });
    }

    const params = new URLSearchParams({
      format: 'jsonv2',
      q: query,
      polygon_geojson: '1',
      limit: '8',
      addressdetails: '1',
      'accept-language': 'id',
      countrycodes: 'id'   // aplikasi ini dipakai untuk wilayah Indonesia
    });
    const url = 'https://nominatim.openstreetmap.org/search?' + params.toString();

    return throttle(() => fetch(url, { headers: { Accept: 'application/json' } }))
      .then(r => {
        if (!r.ok) throw new Error('Layanan menolak permintaan (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(data => {
        let results = (Array.isArray(data) ? data : []).filter(isRealBoundary);
        if (level && level !== 'any') {
          results = results.filter(r => levelOf(r.place_rank).id === level);
        }
        // Bentuk ringkas agar hemat kuota localStorage.
        const slim = results.map(r => ({
          name: r.display_name,
          short: r.name || r.display_name.split(',')[0],
          rank: r.place_rank,
          osm: r.osm_type + '/' + r.osm_id,
          geom: r.geojson
        }));
        if (slim.length) cacheSet(key, slim);
        return { results: slim, fromCache: false };
      });
  }

  /* -------------------- Menggambar lapisan -------------------- */
  function ensureLayer() {
    if (!layerGroup) {
      layerGroup = L.geoJSON(null, {
        // Gaya sengaja dibuat netral & berbeda dari fitur delinasi user:
        // garis putus-putus gelap, tanpa isian.
        style: {
          color: '#1f2d3d',
          weight: 2,
          opacity: 0.9,
          dashArray: '6 4',
          fill: true,
          fillColor: '#1f2d3d',
          fillOpacity: 0.05,
          interactive: false
        }
      });
    }
    return layerGroup;
  }

  function draw(result) {
    const g = ensureLayer();
    g.clearLayers();
    g.addData({ type: 'Feature', properties: {}, geometry: result.geom });

    if (!map.hasLayer(g)) g.addTo(map);
    g.bringToFront();
    // Tetap di belakang fitur delinasi user.
    if (typeof drawnItems !== 'undefined' && drawnItems.bringToFront) {
      drawnItems.bringToFront();
    }
    lastResult = result;
  }

  function clear() {
    if (layerGroup) {
      layerGroup.clearLayers();
      if (map && map.hasLayer(layerGroup)) map.removeLayer(layerGroup);
    }
    lastResult = null;
  }

  function setVisible(on) {
    if (!layerGroup) return;
    if (on) {
      if (!map.hasLayer(layerGroup)) layerGroup.addTo(map);
    } else if (map.hasLayer(layerGroup)) {
      map.removeLayer(layerGroup);
    }
  }

  function toggle() {
    if (!layerGroup || !layerGroup.getLayers().length) return false;
    if (map.hasLayer(layerGroup)) {
      map.removeLayer(layerGroup);
      return false;
    }
    layerGroup.addTo(map);
    return true;
  }

  function hasData() {
    return !!(layerGroup && layerGroup.getLayers().length);
  }

  return {
    search: search,
    draw: draw,
    clear: clear,
    setVisible: setVisible,
    toggle: toggle,
    hasData: hasData,
    levelOf: levelOf,
    countPoints: countPoints,
    isRealBoundary: isRealBoundary,
    get current() { return lastResult; },
    clearCache: function () {
      try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    }
  };
})();
