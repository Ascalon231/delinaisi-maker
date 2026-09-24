/* ============================================================
   Delinaisi Maker — formal-layout.js
   Preset ke-5: "Kop Akademik" / Formal.

   Tata letak kop peta kartografi standar (gaya tugas studio PWK /
   skripsi / laporan teknis GIS):
     - 2 kolom: peta (±75%) di kiri, panel informasi (±25%) di kanan
     - border hitam tipis + graticule (grid lintang/bujur) berlabel
       di keempat sisi frame peta (di luar area peta)
     - panel kanan: kop instansi, judul kegiatan, judul peta, skala
       (mata angin + skala batang alternating), sistem referensi,
       diagram lokasi (inset), legenda otomatis, sumber data,
       blok pengesahan tanda tangan

   Arsitektur (Opsi B - hybrid):
     Layout tetap HTML/CSS. Peta utama & inset tetap instance Leaflet
     asli. Graticule digambar manual ke <canvas> milik overlay khusus
     supaya label koordinat bisa diletakkan di LUAR area peta (di
     margin frame), lalu dijahit ke dalam satu kanvas oleh ekspor
     html2canvas yang sudah dipakai aplikasi ini.

   Semua teks berasal dari input user — tidak ada topik yang di-hardcode.
   ============================================================ */

'use strict';

const FormalLayout = (function () {

  /* -------------------- Format koordinat (DMS) -------------------- */
  // 107.25 -> 107°15'0"E
  function toDMS(value, isLat) {
    const hemi = isLat
      ? (value >= 0 ? 'N' : 'S')
      : (value >= 0 ? 'E' : 'W');
    let v = Math.abs(value);
    let d = Math.floor(v);
    let mFloat = (v - d) * 60;
    let m = Math.floor(mFloat);
    let s = Math.round((mFloat - m) * 60);
    // Normalisasi pembulatan (mis. 59.6" -> 60")
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    return d + '\u00B0' + m + "'" + s + '"' + hemi;
  }

  // Interval graticule menyesuaikan zoom (derajat). Skala kabupaten
  // khas ada di zoom 9-11 -> interval 0°05'-0°10'.
  const INTERVALS = [
    { max: 3,  step: 10 },
    { max: 5,  step: 5 },
    { max: 7,  step: 2 },
    { max: 9,  step: 0.5 },
    { max: 11, step: 1 / 6 },   // 10 menit
    { max: 13, step: 1 / 30 },  // 2 menit
    { max: 20, step: 1 / 120 }  // 30 detik
  ];

  function intervalFor(zoom) {
    for (let i = 0; i < INTERVALS.length; i++) {
      if (zoom <= INTERVALS[i].max) return INTERVALS[i].step;
    }
    return INTERVALS[INTERVALS.length - 1].step;
  }

  // Jarak "bulat" untuk skala batang: 0,1,2,4,6,8 km dst.
  function niceDistance(meters) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500,
      1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] >= meters) return steps[i];
    }
    return steps[steps.length - 1];
  }

  function fmtNumber(n) {
    return n.toLocaleString('id-ID');
  }

  /* -------------------- Graticule ke canvas -------------------- */
  // Menggambar grid lintang/bujur pada kanvas berukuran `size`,
  // beserta label DMS di margin luar frame.
  function drawGraticule(ctx, map, size, opts) {
    opts = opts || {};
    const margin = opts.margin != null ? opts.margin : 0;
    // Langkah bisa dipaksa (dipakai inset yang perlu grid lebih jarang),
    // atau dihitung dari zoom peta.
    const step = opts.step != null ? opts.step : intervalFor(map.getZoom());
    const fontSize = opts.fontSize || 10;
    const showEdgeLabels = opts.showEdgeLabels !== false;

    // Area peta di dalam margin frame
    const x0 = margin, y0 = margin;
    const x1 = size.x - margin, y1 = size.y - margin;

    // Batas geografis dari sudut area peta
    const nw = map.containerPointToLatLng([x0, y0]);
    const se = map.containerPointToLatLng([x1, y1]);

    const latTop = nw.lat, latBot = se.lat;
    const lngLeft = nw.lng, lngRight = se.lng;

    ctx.save();
    ctx.font = fontSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.strokeStyle = opts.color || 'rgba(20,20,20,.55)';
    ctx.fillStyle = opts.fontColor || '#1a1a1a';

    // --- Garis lintang (horizontal) ---
    const firstLat = Math.ceil(latBot / step) * step;
    for (let lat = firstLat; lat <= latTop; lat += step) {
      const p = map.latLngToContainerPoint(L.latLng(lat, lngLeft));
      const y = p.y;
      if (y < y0 - 1 || y > y1 + 1) continue;

      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      const label = toDMS(lat, true);
      if (showEdgeLabels) {
        ctx.textAlign = 'left';
        // Label di sisi KIRI (di margin) dan KANAN (di margin)
        ctx.fillText(label, margin > 16 ? 2 : x0 + 3, y);
        ctx.textAlign = 'right';
        ctx.fillText(label, size.x - (margin > 16 ? 2 : 3), y);
      }
    }

    // --- Garis bujur (vertikal) ---
    const firstLng = Math.ceil(lngLeft / step) * step;
    for (let lng = firstLng; lng <= lngRight; lng += step) {
      const p = map.latLngToContainerPoint(L.latLng(latTop, lng));
      const x = p.x;
      if (x < x0 - 1 || x > x1 + 1) continue;

      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();

      const label = toDMS(lng, false);
      if (showEdgeLabels) {
        ctx.textAlign = 'center';
        // Label di sisi ATAS dan BAWAH (di margin)
        ctx.fillText(label, x, margin > 16 ? 8 : y0 + 10);
        ctx.fillText(label, x, size.y - (margin > 16 ? 8 : 10));
      }
    }

    ctx.restore();
  }

  /* -------------------- Skala batang alternating -------------------- */
  // Menggambar skala bergaya peta cetak: kotak hitam-putih berselang,
  // angka di bawah tiap segmen. Mengembalikan { el } berupa SVG.
  function buildScaleBar(map, containerWidth) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const maxPx = Math.max(90, Math.min(containerWidth - 24, 210));

    const y = map.getBounds().getNorth();
    const x = map.getBounds().getWest();
    const metersPerPx = (function () {
      const p1 = map.latLngToContainerPoint(L.latLng(y, x));
      const p2 = map.latLngToContainerPoint(L.latLng(y, x + 0.01));
      const px = Math.abs(p2.x - p1.x) || 1;
      const m = 0.01 * 111320 * Math.cos(y * Math.PI / 180);
      return m / px;
    })();

    const targetMeters = metersPerPx * maxPx;
    const totalMeters = niceDistance(targetMeters);
    const pxPerMeter = maxPx / targetMeters;
    const barPx = totalMeters * pxPerMeter;

    // Segmen mengikuti gaya skala peta cetak: tiap segmen diberi angka
    // jarak kumulatif di bawahnya. Dipakai 4 segmen (5 angka: 0..total).
    const segs = 4;
    const segPx = barPx / segs;
    const useKm = totalMeters >= 1000;
    const unit = useKm ? 'Kilometers' : 'Meters';

    const H = 7;
    const padL = 2, padR = 2, top = 14, labelH = 13, unitH = 12;
    const W = barPx + padL + padR;
    const Htotal = top + H + labelH + unitH;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(Math.ceil(W)));
    svg.setAttribute('height', String(Htotal));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Htotal);
    svg.setAttribute('class', 'fl-scalebar-svg');

    // Nilai tiap batas segmen, dibulatkan supaya angkanya bulat & terbaca
    // (mis. 0, 2, 4, 6, 8 km). Dihitung dari jarak total yang "bulat".
    const unitDiv = useKm ? 1000 : 1;
    const tickValues = [];
    for (let i = 0; i <= segs; i++) {
      tickValues.push(Math.round((totalMeters / segs * i) / unitDiv));
    }

    // Alternating hitam-putih
    for (let i = 0; i < segs; i++) {
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', String(padL + i * segPx));
      r.setAttribute('y', String(top));
      r.setAttribute('width', String(segPx));
      r.setAttribute('height', String(H));
      r.setAttribute('fill', i % 2 === 0 ? '#111111' : '#ffffff');
      r.setAttribute('stroke', '#111111');
      r.setAttribute('stroke-width', '0.9');
      svg.appendChild(r);
    }

    // Angka di bawah tiap BATAS segmen (termasuk ujung kiri & kanan)
    for (let i = 0; i <= segs; i++) {
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', String(padL + i * segPx));
      t.setAttribute('y', String(top + H + 10));
      t.setAttribute('text-anchor', i === 0 ? 'start' : (i === segs ? 'end' : 'middle'));
      t.setAttribute('font-size', '9.5');
      t.setAttribute('font-family', 'sans-serif');
      t.setAttribute('fill', '#111111');
      t.textContent = String(tickValues[i]);
      svg.appendChild(t);
    }

    // Satuan
    const tu = document.createElementNS(svgNS, 'text');
    tu.setAttribute('x', String(padL + barPx / 2));
    tu.setAttribute('y', String(top + H + labelH + 8));
    tu.setAttribute('text-anchor', 'middle');
    tu.setAttribute('font-size', '9');
    tu.setAttribute('font-family', 'sans-serif');
    tu.setAttribute('fill', '#333333');
    tu.textContent = unit;
    svg.appendChild(tu);

    return svg;
  }

  /* -------------------- Skala numerik (1:xxx) -------------------- */
  function representativeFraction(map) {
    // Perkiraan skala pada lintang tengah (asumsi layar 96 dpi).
    const c = map.getCenter();
    const p1 = map.latLngToContainerPoint(c);
    const p2 = map.latLngToContainerPoint(
      L.latLng(c.lat, c.lng + 0.01));
    const px = Math.abs(p2.x - p1.x) || 1;
    const meters = 0.01 * 111320 * Math.cos(c.lat * Math.PI / 180);
    const metersPerPx = meters / px;
    const metersPerInch = metersPerPx * 96;
    return Math.round(metersPerInch / 0.0254);
  }

  /* -------------------- Ikon mata angin -------------------- */
  function buildCompass() {
    const wrap = document.createElement('div');
    wrap.className = 'fl-compass';
    wrap.setAttribute('aria-label', 'Arah utara');
    wrap.innerHTML =
      '<svg viewBox="0 0 40 40" width="40" height="40">' +
        '<circle cx="20" cy="20" r="18" fill="none" stroke="#111" stroke-width="0.8"/>' +
        '<path d="M20 4 L24.5 20 L20 17.6 L15.5 20 Z" fill="#111"/>' +
        '<path d="M20 36 L15.5 20 L20 22.4 L24.5 20 Z" fill="#fff" stroke="#111" stroke-width="0.7"/>' +
        '<text x="20" y="12.6" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="700" fill="#111">N</text>' +
      '</svg>';
    return wrap;
  }

  return {
    toDMS: toDMS,
    intervalFor: intervalFor,
    drawGraticule: drawGraticule,
    buildScaleBar: buildScaleBar,
    representativeFraction: representativeFraction,
    buildCompass: buildCompass,
    fmtNumber: fmtNumber
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FormalLayout;
}
