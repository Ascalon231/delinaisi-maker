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
    let v0 = value;
    // Normalisasi: lintang dijepit ke -90..90, bujur dilipat ke -180..180.
    // Tanpa ini, label bisa tercetak "190°0'0\"E" yang mustahil.
    if (isLat) {
      v0 = Math.max(-90, Math.min(90, v0));
    } else {
      v0 = ((v0 + 180) % 360 + 360) % 360 - 180;
      if (v0 === -180) v0 = 180;
    }
    const hemi = isLat
      ? (v0 >= 0 ? 'N' : 'S')
      : (v0 >= 0 ? 'E' : 'W');
    let v = Math.abs(v0);
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
  // Jarak bulat terbesar yang TIDAK melebihi nilai acuan. Dipakai skala
  // batang supaya lebarnya tidak pernah melampaui ruang yang tersedia.
  function niceDistanceFloor(meters) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500,
      1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000,
      1000000, 2000000, 5000000];
    let pilih = steps[0];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] <= meters) pilih = steps[i]; else break;
    }
    return pilih;
  }

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

  // Geser posisi label agar seluruh teksnya berada di dalam lebar kanvas.
  // Label di tepi paling rawan terpotong saat diekspor ke PNG.
  function clampLabel(x, textWidth, align, canvasWidth, pad) {
    // Padding menjaga teks tidak menempel tepi kanvas. Tanpa ini, label yang
    // dijepit tepat ke tepi akan terlihat terpotong saat diekspor PNG.
    const p = (pad == null) ? 6 : pad;
    const minLeft = Math.min(p, Math.max(0, canvasWidth - textWidth));
    const maxLeft = Math.max(minLeft, canvasWidth - textWidth - p);
    let left = (align === 'left') ? x
      : (align === 'right') ? x - textWidth
      : x - textWidth / 2;
    left = Math.max(minLeft, Math.min(left, maxLeft));
    if (align === 'left') return left;
    if (align === 'right') return left + textWidth;
    return left + textWidth / 2;
  }

  /* -------------------- Graticule ke canvas -------------------- */
  // Menggambar grid lintang/bujur pada kanvas berukuran `size`,
  // beserta label DMS di margin luar frame atau di dalam area peta.
  function drawGraticule(ctx, map, size, opts) {
    opts = opts || {};
    const step = opts.step != null ? opts.step : intervalFor(map.getZoom());
    const fontSize = opts.fontSize || 10;
    const showEdgeLabels = opts.showEdgeLabels !== false;
    const labelPos = opts.labelPosition || 'outside';
    const isInside = labelPos === 'inside';

    let mL = 0, mR = 0, mT = 0, mB = 0;
    if (!isInside && opts.margin) {
      if (typeof opts.margin === 'object') {
        mL = opts.margin.left || 0;
        mR = opts.margin.right || 0;
        mT = opts.margin.top || 0;
        mB = opts.margin.bottom || 0;
      } else {
        mL = mR = mT = mB = Number(opts.margin) || 0;
      }
    }

    // Jika mode outside tapi margin 0 (mis. inset), pakai pad standar 12px
    if (!isInside && mL === 0 && mR === 0 && mT === 0 && mB === 0) {
      const pad = opts.pad != null ? opts.pad : 12;
      mL = mR = mT = mB = pad;
    }

    const x0 = isInside ? 2 : mL;
    const y0 = isInside ? 2 : mT;
    const x1 = isInside ? size.x - 2 : size.x - mR;
    const y1 = isInside ? size.y - 2 : size.y - mB;

    // Batas geografis dari sudut area peta aktif
    const mapW = isInside ? size.x : Math.max(10, size.x - mL - mR);
    const mapH = isInside ? size.y : Math.max(10, size.y - mT - mB);
    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([mapW, mapH]);

    const latTop = nw.lat, latBot = se.lat;
    const lngLeft = nw.lng, lngRight = se.lng;

    ctx.save();
    ctx.font = fontSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.strokeStyle = opts.color || 'rgba(20,20,20,.55)';
    ctx.fillStyle = opts.fontColor || '#1a1a1a';

    function drawLabel(text, x, y, align, isInner) {
      ctx.textAlign = align;
      if (isInner) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = 3.5;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = opts.fontColor || '#111111';
        ctx.fillText(text, x, y);
        ctx.restore();
      } else {
        ctx.fillText(text, x, y);
      }
    }

    // --- Garis lintang (horizontal) ---
    const firstLat = Math.ceil(latBot / step) * step;
    for (let lat = firstLat; lat <= latTop; lat += step) {
      const p = map.latLngToContainerPoint(L.latLng(lat, lngLeft));
      const y = isInside ? p.y : (p.y + mT);
      if (y < y0 || y > y1) continue;

      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      const label = toDMS(lat, true);
      if (showEdgeLabels) {
        const tw = ctx.measureText(label).width;
        if (isInside) {
          const leftX = 8;
          const rightX = size.x - 8;
          const textY = Math.max(14, Math.min(size.y - 14, y - 4));
          drawLabel(label, leftX, textY, 'left', true);
          drawLabel(label, rightX, textY, 'right', true);
        } else {
          // Garis centang kecil (tick mark) di antara margin
          ctx.beginPath();
          ctx.moveTo(Math.max(2, x0 - 4), y); ctx.lineTo(x0, y);
          ctx.moveTo(x1, y); ctx.lineTo(Math.min(size.x - 2, x1 + 4), y);
          ctx.stroke();

          // Label di margin kiri & kanan (bersih di atas latar kertas putih)
          drawLabel(label, Math.max(3, x0 - 6), y, 'right', false);
          drawLabel(label, Math.min(size.x - 3, x1 + 6), y, 'left', false);
        }
      }
    }

    // --- Garis bujur (vertikal) ---
    const firstLng = Math.ceil(lngLeft / step) * step;
    for (let lng = firstLng; lng <= lngRight; lng += step) {
      const p = map.latLngToContainerPoint(L.latLng(latTop, lng));
      const x = isInside ? p.x : (p.x + mL);
      if (x < x0 || x > x1) continue;

      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();

      const label = toDMS(lng, false);
      if (showEdgeLabels) {
        const tw = ctx.measureText(label).width;
        if (isInside) {
          const cx = clampLabel(x, tw, 'center', size.x, 8);
          const cyTop = 14;
          const cyBot = size.y - 10;
          drawLabel(label, cx, cyTop, 'center', true);
          drawLabel(label, cx, cyBot, 'center', true);
        } else {
          // Garis centang kecil (tick mark) di antara margin
          ctx.beginPath();
          ctx.moveTo(x, Math.max(2, y0 - 4)); ctx.lineTo(x, y0);
          ctx.moveTo(x, y1); ctx.lineTo(x, Math.min(size.y - 2, y1 + 4));
          ctx.stroke();

          const cx = clampLabel(x, tw, 'center', size.x, 6);
          const cyTop = Math.round(mT / 2) + 1;
          const cyBot = Math.round(size.y - mB / 2);
          drawLabel(label, cx, cyTop, 'center', false);
          drawLabel(label, cx, cyBot, 'center', false);
        }
      }
    }

    ctx.restore();
  }

  /* -------------------- Skala batang alternating -------------------- */
  // Menggambar skala bergaya peta cetak: kotak hitam-putih berselang,
  // angka di bawah tiap segmen. Mengembalikan { el } berupa SVG.
  function buildScaleBar(map, containerWidth) {
    const svgNS = 'http://www.w3.org/2000/svg';
    // Lebar skala harus benar-benar muat di ruang yang tersedia.
    // Sebelumnya niceDistance() membulatkan jarak KE ATAS, sehingga batang
    // bisa jauh lebih lebar dari anggaran dan menembus batas panel
    // (terukur 473px di panel 300px). Anggaran kini dipakai untuk memilih
    // jarak bulat terbesar yang MASIH muat, bukan yang terkecil di atasnya.
    const tersedia = Math.max(80, Math.floor(containerWidth) - 6);
    const maxPx = Math.max(60, Math.min(tersedia, 200));

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
    // Pilih jarak bulat yang tidak melebihi anggaran piksel.
    const totalMeters = niceDistanceFloor(targetMeters);
    const pxPerMeter = maxPx / targetMeters;
    const barPx = Math.min(totalMeters * pxPerMeter, maxPx);

    // Segmen mengikuti gaya skala peta cetak: tiap segmen diberi angka
    // jarak kumulatif di bawahnya. Dipakai 4 segmen (5 angka: 0..total).
    const segs = 4;
    const segPx = barPx / segs;
    // Satuan memakai istilah Indonesia yang lazim di peta cetak.
    const useKm = totalMeters >= 1000;
    const unit = useKm ? 'Kilometer' : 'Meter';

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
  /* -------------------- Ikon mata angin (beragam varian kartografi) -------------------- */
  function buildCompass(style, letter) {
    const s = style || 'classic';
    const l = (letter || 'U').toUpperCase();
    const wrap = document.createElement('div');
    wrap.className = 'fl-compass fl-compass--' + s;
    wrap.setAttribute('aria-label', 'Arah utara');

    let svgInner = '';
    if (s === 'triangle') {
      svgInner =
        '<text x="20" y="7.5" text-anchor="middle" font-size="8.5" font-family="sans-serif" font-weight="800" fill="#111">' + l + '</text>' +
        '<polygon points="20,10 14,35 20,31" fill="#111"/>' +
        '<polygon points="20,10 26,35 20,31" fill="#fff" stroke="#111" stroke-width="0.8"/>' +
        '<line x1="20" y1="10" x2="20" y2="35" stroke="#111" stroke-width="0.6"/>';
    } else if (s === 'modern') {
      svgInner =
        '<text x="20" y="7" text-anchor="middle" font-size="8.5" font-family="sans-serif" font-weight="800" fill="#111">' + l + '</text>' +
        '<path d="M20 10 L20 37" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>' +
        '<polygon points="20,8 14,20 20,17.5" fill="#111"/>' +
        '<polygon points="20,8 26,20 20,17.5" fill="#fff" stroke="#111" stroke-width="0.8"/>';
    } else if (s === 'star') {
      svgInner =
        '<circle cx="20" cy="20" r="18" fill="none" stroke="#111" stroke-width="0.8"/>' +
        '<polygon points="20,20 12,12 20,16" fill="#111"/>' +
        '<polygon points="20,20 12,12 16,20" fill="#fff" stroke="#111" stroke-width="0.5"/>' +
        '<polygon points="20,20 28,12 20,16" fill="#fff" stroke="#111" stroke-width="0.5"/>' +
        '<polygon points="20,20 28,12 24,20" fill="#111"/>' +
        '<polygon points="20,20 12,28 16,20" fill="#111"/>' +
        '<polygon points="20,20 12,28 20,24" fill="#fff" stroke="#111" stroke-width="0.5"/>' +
        '<polygon points="20,20 28,28 24,20" fill="#fff" stroke="#111" stroke-width="0.5"/>' +
        '<polygon points="20,20 28,28 20,24" fill="#111"/>' +
        '<polygon points="20,20 20,4 17,20" fill="#111"/>' +
        '<polygon points="20,20 20,4 23,20" fill="#fff" stroke="#111" stroke-width="0.6"/>' +
        '<polygon points="20,20 20,36 17,20" fill="#fff" stroke="#111" stroke-width="0.6"/>' +
        '<polygon points="20,20 20,36 23,20" fill="#111"/>' +
        '<polygon points="20,20 4,20 20,17" fill="#fff" stroke="#111" stroke-width="0.6"/>' +
        '<polygon points="20,20 4,20 20,23" fill="#111"/>' +
        '<polygon points="20,20 36,20 20,17" fill="#111"/>' +
        '<polygon points="20,20 36,20 20,23" fill="#fff" stroke="#111" stroke-width="0.6"/>' +
        '<circle cx="20" cy="20" r="2" fill="#111"/>' +
        '<text x="20" y="3.5" text-anchor="middle" font-size="6.5" font-family="sans-serif" font-weight="800" fill="#111">' + l + '</text>';
    } else if (s === 'survey') {
      svgInner =
        '<text x="20" y="8" text-anchor="middle" font-size="8.5" font-family="\'Times New Roman\', serif" font-weight="700" fill="#111">' + l + '</text>' +
        '<path d="M20 9 L20 36" stroke="#111" stroke-width="1.2"/>' +
        '<polygon points="20,10 13,26 20,23" fill="#111"/>' +
        '<polygon points="20,10 27,26 20,23" fill="#fff" stroke="#111" stroke-width="0.8"/>' +
        '<line x1="10" y1="26" x2="30" y2="26" stroke="#111" stroke-width="1"/>' +
        '<circle cx="20" cy="34" r="1.5" fill="#111"/>';
    } else {
      // 'classic' default
      svgInner =
        '<circle cx="20" cy="20" r="18" fill="none" stroke="#111" stroke-width="0.8"/>' +
        '<path d="M20 4 L24.5 20 L20 17.6 L15.5 20 Z" fill="#111"/>' +
        '<path d="M20 36 L15.5 20 L20 22.4 L24.5 20 Z" fill="#fff" stroke="#111" stroke-width="0.7"/>' +
        '<text x="20" y="12.6" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="700" fill="#fff">' + l + '</text>';
    }

    wrap.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40">' + svgInner + '</svg>';
    return wrap;
  }

  function zoomForScale(rf, lat) {
    if (!rf || rf <= 0) return 10;
    const rad = ((lat != null ? lat : 0) * Math.PI) / 180;
    const metersPerPx = (rf * 0.0254) / 96;
    const z = Math.log2((156543.03392 * Math.cos(rad)) / metersPerPx);
    return Math.max(1, Math.min(19, z));
  }

  return {
    toDMS: toDMS,
    clampLabel: clampLabel,
    niceDistanceFloor: niceDistanceFloor,
    intervalFor: intervalFor,
    drawGraticule: drawGraticule,
    buildScaleBar: buildScaleBar,
    representativeFraction: representativeFraction,
    zoomForScale: zoomForScale,
    buildCompass: buildCompass,
    fmtNumber: fmtNumber
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FormalLayout;
}
