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
    if (r <= 4)  return { id: 'country',  label: 'Nasional / Negara' };
    if (r <= 8)  return { id: 'province', label: 'Provinsi' };
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

  /* -------------------- Pembersihan kueri -------------------- */
  // Di OSM, relasi batas Indonesia diberi nama polos ("Cibinong"), bukan
  // "Kecamatan Cibinong". Menyertakan kata tingkat justru membuat
  // pencarian gagal / mengembalikan kantor kecamatan. Awalan ini dibuang
  // otomatis supaya user tidak perlu tahu seluk-beluknya.
  const LEVEL_PREFIX = /^(kecamatan|kec\.?|kelurahan|kel\.?|desa|kabupaten|kab\.?|kota|kotamadya|provinsi|propinsi|daerah istimewa|dki)\s+/i;

  function cleanQuery(q) {
    let out = String(q || '').trim().replace(/\s+/g, ' ');
    // Buang awalan tingkat berulang (mis. "Kecamatan Kelurahan X").
    let guard = 0;
    while (LEVEL_PREFIX.test(out) && guard++ < 3) {
      out = out.replace(LEVEL_PREFIX, '');
    }
    return out.trim() || String(q || '').trim();
  }

  /* -------------------- Mode laut/darat -------------------- */
  // 'any'  = tampilkan batas resmi termasuk wilayah laut (default)
  // 'land' = saring: untuk MultiPolygon, ambil sub-polygon terkecil yang
  //           mewakili daratan (heuristik: biasanya area yang lebih kecil).
  //           Ini tidak sempurna, tapi menghilangkan potongan laut besar.
  let seaMode = 'any';

  function setSeaMode(mode) { seaMode = mode || 'any'; }

  // Pilih sub-polygon yang paling mungkin mewakili daratan.
  // Strategi: untuk MultiPolygon yang luasnya sangat besar, kurangi jumlah
  // koordinat menjadi hanya ring/polygon yang tidak dominan laut.
  // Ini adalah pendekatan kasar — Nominatim tidak menyediakan clip resmi.
  function filterLand(geom) {
    if (!geom || seaMode === 'any') return geom;
    if (geom.type === 'Polygon') return geom; // polygon tunggal tetap apa adanya
    if (geom.type !== 'MultiPolygon') return geom;
    // Hitung luas semu tiap poligon (bounding box * koordinat = perkiraan)
    const polys = geom.coordinates;
    if (polys.length <= 1) return geom;
    // Pakai luas bounding box sebagai indikator: pilih semua polygon kecuali
    // yang luasnya lebih dari 5x rata-rata (kemungkinan besar laut).
    const areas = polys.map(poly => {
      const ring = poly[0];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      ring.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      return (maxX - minX) * (maxY - minY);
    });
    const avg = areas.reduce((a, b) => a + b, 0) / areas.length;
    const selected = polys.filter((_, i) => areas[i] <= avg * 5);
    if (!selected.length) return geom;
    if (selected.length === 1) return { type: 'Polygon', coordinates: selected[0] };
    return { type: 'MultiPolygon', coordinates: selected };
  }

  /* -------------------- Pencarian -------------------- */
  function search(query, level) {
    const key = 'q:' + cleanQuery(query).toLowerCase() + '|' + (level || 'any');
    const cached = cacheGet(key);
    if (cached) {
      return Promise.resolve({ results: cached, fromCache: true });
    }

    // Untuk level nasional, jangan batasi ke countrycodes tertentu
    // agar batas Indonesia (relasi OSM) bisa ditemukan.
    const paramObj = {
      format: 'jsonv2',
      q: cleanQuery(query),
      polygon_geojson: '1',
      limit: '8',
      addressdetails: '1',
      'accept-language': 'id'
    };
    if (level !== 'country') paramObj.countrycodes = 'id';

    const params = new URLSearchParams(paramObj);
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

  const OFFICIAL_PALETTE = [
    '#2563eb', '#059669', '#d97706', '#7c3aed',
    '#db2777', '#0891b2', '#ea580c', '#4f46e5',
    '#16a34a', '#ca8a04', '#9333ea', '#e11d48'
  ];

  function draw(result) {
    const g = ensureLayer();
    g.clearLayers();

    if (result.isCollection && Array.isArray(result.featuresList)) {
      result.featuresList.forEach((f, idx) => {
        if (!f.geom) return;
        const color = OFFICIAL_PALETTE[idx % OFFICIAL_PALETTE.length];
        const sub = L.geoJSON({ type: 'Feature', properties: { name: f.name }, geometry: f.geom }, {
          style: {
            color: color,
            weight: 2,
            opacity: 0.9,
            dashArray: '5 3',
            fill: true,
            fillColor: color,
            fillOpacity: 0.12,
            interactive: true
          }
        });
        if (f.name) {
          sub.bindTooltip(f.name, { sticky: true, className: 'admin-map-tooltip' });
        }
        g.addLayer(sub);
      });
    } else if (result.geom) {
      const geom = filterLand(result.geom);
      g.addData({ type: 'Feature', properties: {}, geometry: geom });
    }

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

  /* -------------------- Katalog Wilayah Resmi (Kemendagri / BPS) -------------------- */
  const DISTRICT_CACHE_KEY = 'delinaisi-admin-districts-v1';
  const memDistrictCache = new Map();

  function readDistrictStorageCache() {
    try {
      const raw = localStorage.getItem(DISTRICT_CACHE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (e) { return {}; }
  }

  function writeDistrictStorageCache(cache) {
    try {
      localStorage.setItem(DISTRICT_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      try {
        const keys = Object.keys(cache);
        if (keys.length > 4) {
          keys.slice(0, Math.floor(keys.length / 2)).forEach(k => delete cache[k]);
          localStorage.setItem(DISTRICT_CACHE_KEY, JSON.stringify(cache));
        }
      } catch (e2) {}
    }
  }

  function fixRing(coords) {
    if (!Array.isArray(coords)) return null;
    const ring = coords
      .map(pt => {
        if (!Array.isArray(pt) || pt.length < 2) return null;
        const lat = Number(pt[0]);
        const lng = Number(pt[1]);
        if (isNaN(lat) || isNaN(lng)) return null;
        return [lng, lat];
      })
      .filter(Boolean);

    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    return ring;
  }

  function pathToGeometry(path) {
    if (!path || !Array.isArray(path) || !path.length) return null;

    if (typeof path[0][0] === 'number') {
      const ring = fixRing(path);
      return ring ? { type: 'Polygon', coordinates: [ring] } : null;
    }

    const rings = path.map(fixRing).filter(Boolean);
    if (!rings.length) return null;

    if (rings.length === 1) {
      return { type: 'Polygon', coordinates: [rings[0]] };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: rings.map(r => [r])
      };
    }
  }

  function fetchDistricts(kabId, level) {
    const lvl = (level === 'desa') ? 'desa' : 'kecamatan';
    const cacheKey = `${lvl}:${kabId}`;

    if (memDistrictCache.has(cacheKey)) {
      return Promise.resolve(memDistrictCache.get(cacheKey));
    }

    const sCache = readDistrictStorageCache();
    if (sCache[cacheKey]) {
      memDistrictCache.set(cacheKey, sCache[cacheKey]);
      return Promise.resolve(sCache[cacheKey]);
    }

    const primaryUrl = `https://cdn.jsdelivr.net/gh/hendisantika/spring-boot-indonesia-map@main/src/main/resources/static/geojson/${lvl}/${kabId}.json`;
    const fallbackUrl = `https://raw.githubusercontent.com/hendisantika/spring-boot-indonesia-map/main/src/main/resources/static/geojson/${lvl}/${kabId}.json`;

    return fetch(primaryUrl)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(() => {
        return fetch(fallbackUrl).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      })
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        memDistrictCache.set(cacheKey, list);
        sCache[cacheKey] = list;
        writeDistrictStorageCache(sCache);
        return list;
      });
  }

  function getProvinces() {
    return (typeof window !== 'undefined' && window.INDONESIA_ADM) ||
           (typeof INDONESIA_ADM !== 'undefined' ? INDONESIA_ADM : []);
  }

  function getRegencies(provId) {
    const provs = getProvinces();
    const p = provs.find(item => String(item.id) === String(provId));
    return p ? (p.kab || []) : [];
  }

  return {
    search: search,
    draw: draw,
    clear: clear,
    setVisible: setVisible,
    toggle: toggle,
    hasData: hasData,
    levelOf: levelOf,
    cleanQuery: cleanQuery,
    countPoints: countPoints,
    isRealBoundary: isRealBoundary,
    setSeaMode: setSeaMode,
    filterLand: filterLand,
    get current() { return lastResult; },
    clearCache: function () {
      try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
      try { localStorage.removeItem(DISTRICT_CACHE_KEY); } catch (e) {}
      memDistrictCache.clear();
    },
    // ---- Metode Katalog Resmi (BPS / Kemendagri) ----
    pathToGeometry: pathToGeometry,
    fetchDistricts: fetchDistricts,
    getProvinces: getProvinces,
    getRegencies: getRegencies,
    getBounds: function () {
      return (layerGroup && layerGroup.getLayers().length) ? layerGroup.getBounds() : null;
    }
  };
})();
