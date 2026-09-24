// @ts-check
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const APP = pathToFileURL(path.join(__dirname, '..', 'index.html')).href + '?nohelp';

// Tiap test pakai kondisi bersih (localStorage tidak bocor antar test).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('delinaisi-maker-v1'); } catch (e) {}
  });
});

// Helper: klik beberapa titik di peta untuk membentuk poligon, lalu selesaikan
// dengan memanggil completeShape() langsung (paling andal di headless browser).
async function drawPolygon(page, points) {
  const map = page.locator('#map');
  for (const [x, y] of points) {
    await map.click({ position: { x, y } });
    await page.waitForTimeout(130);
  }
  await page.evaluate(() => {
    // Selesaikan gambar aktif lewat API publik leaflet-draw.
    if (window.__drawer) { try { window.__drawer.completeShape(); } catch (e) {} }
  });
  await page.waitForTimeout(400);
}

test('aplikasi dimuat tanpa error konsol', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    // Abaikan pesan tile jaringan (lingkungan test mungkin offline sebagian).
    if (m.type() === 'error' && /Failed to fetch|net::|ERR_|tile/i.test(m.text())) return;
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  // Tile pane ada di DOM (tile sendiri bisa lambat di lingkungan test).
  await expect(page.locator('#map .leaflet-tile-pane')).toHaveCount(1);
  await page.waitForTimeout(1500);

  expect(errors).toEqual([]);
});

test('gambar poligon → hitung luas → modal atribut muncul', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  // pilih alat poligon
  await page.locator('.tool[data-tool="Polygon"]').click();
  await expect(page.locator('.tool[data-tool="Polygon"]')).toHaveClass(/active/);

  // gambar segitiga di tengah peta
  await drawPolygon(page, [[500, 200], [800, 200], [650, 450]]);

  // modal harus muncul dengan hasil ukur
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#attr-measure')).toContainText(/Luas/);
  const areaText = await page.locator('#attr-measure').textContent();
  expect(areaText).toMatch(/[0-9]/);
});

test('simpan atribut & muncul di daftar fitur', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('.tool[data-tool="Polygon"]').click();
  await drawPolygon(page, [[400, 250], [750, 250], [575, 480]]);

  await page.locator('#attr-name').fill('Batas Kelurahan Contoh');
  await page.locator('#attr-category').selectOption('batas_admin');
  await page.locator('#attr-save').click();
  await page.waitForTimeout(300);

  // modal tertutup
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);
  // daftar fitur berisi 1 item dengan nama tsb
  await expect(page.locator('#feat-count')).toHaveText('1');
  await expect(page.locator('.feat-name')).toHaveText('Batas Kelurahan Contoh');
});

test('tersimpan ke localStorage & termuat ulang', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('.tool[data-tool="Polygon"]').click();
  await drawPolygon(page, [[400, 250], [750, 250], [575, 480]]);
  await page.locator('#attr-name').fill('Wilayah Uji');
  await page.locator('#attr-save').click();
  await page.waitForTimeout(400);

  // Verifikasi data tersimpan dengan benar di localStorage.
  const stored = await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1'));
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored);
  expect(parsed.features).toHaveLength(1);
  expect(parsed.features[0].name).toBe('Wilayah Uji');
  expect(parsed.layout).toBeDefined();

  // Muat ulang dengan data yang sama dipulihkan (simulasi storage persisten).
  await page.addInitScript((data) => {
    localStorage.setItem('delinaisi-maker-v1', data);
  }, stored);
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(page.locator('#feat-count')).toHaveText('1');
  await expect(page.locator('.feat-name')).toHaveText('Wilayah Uji');
});

test('undo: fitur yang dihapus bisa dipulihkan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.locator('.tool[data-tool="Marker"]').click();
  await page.locator('#map').click({ position: { x: 600, y: 300 } });
  await page.locator('#attr-name').fill('Marker Uji');
  await page.locator('#attr-save').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#feat-count')).toHaveText('1');

  // Hapus
  await page.locator('.feat-acts .icon-btn.del').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#feat-count')).toHaveText('0');
  // Toast undo muncul
  await expect(page.locator('#toast .toast-action')).toHaveText('Urungkan');

  // Klik Urungkan
  await page.locator('#toast .toast-action').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#feat-count')).toHaveText('1');
  await expect(page.locator('.feat-name')).toHaveText('Marker Uji');
});

test('pintasan keyboard mengaktifkan alat gambar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  await expect(page.locator('.tool[data-tool="Polygon"]')).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await expect(page.locator('.tool[data-tool="Polygon"]')).not.toHaveClass(/active/);
});

test('mobile: drawer sidebar bisa buka & tutup', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Awalnya tertutup
  await expect(page.locator('#sidebar')).toHaveClass(/closed/);
  await expect(page.locator('#sidebar-close')).not.toHaveClass(/show/);

  // Buka
  await page.evaluate(() => document.querySelector('#sidebar-toggle').click());
  await page.waitForTimeout(600);
  await expect(page.locator('#sidebar')).not.toHaveClass(/closed/);
  await expect(page.locator('#sidebar-close')).toHaveClass(/show/);

  // Tombol X menutup
  await page.evaluate(() => document.querySelector('#sidebar-close').click());
  await page.waitForTimeout(600);
  await expect(page.locator('#sidebar')).toHaveClass(/closed/);
});

test('ekspor GeoJSON mengunduh file yang valid', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('.tool[data-tool="Polygon"]').click();
  await drawPolygon(page, [[400, 250], [750, 250], [575, 480]]);
  await page.locator('#attr-name').fill('Ekspor Uji');
  await page.locator('#attr-save').click();
  await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-geojson').click()
  ]);
  expect(download.suggestedFilename()).toBe('peta-delinasi.geojson');

  const content = await (await download.path()).toString('utf-8');
  const gj = JSON.parse(require('fs').readFileSync(await download.path(), 'utf-8'));
  expect(gj.type).toBe('FeatureCollection');
  expect(gj.features).toHaveLength(1);
  expect(gj.features[0].properties.name).toBe('Ekspor Uji');
  expect(gj.features[0].geometry.type).toBe('Polygon');
});

test('alat titik membuat marker dengan koordinat', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('.tool[data-tool="Marker"]').click();
  await page.locator('#map').click({ position: { x: 600, y: 300 } });
  await page.waitForTimeout(300);

  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#attr-measure')).toContainText(/Koordinat/);
});

test('ganti peta dasar aktif tanpa error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('[data-basemap="satellite"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-basemap="satellite"]')).toHaveClass(/active/);

  await page.locator('[data-basemap="light"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-basemap="light"]')).toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('layout peta: judul, legenda, utara & kredit tampil di atas peta', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  // Judul muncul saat diisi
  await page.locator('#layout-title').fill('Peta Delinasi Kampus');
  await page.locator('#layout-author').fill('Budi, Mahasiswa Geografi');
  await page.waitForTimeout(200);
  await expect(page.locator('#map-title')).toBeVisible();
  await expect(page.locator('#map-title')).toHaveText('Peta Delinasi Kampus');
  await expect(page.locator('#map-credit')).toContainText('Budi, Mahasiswa Geografi');
  await expect(page.locator('#map-north')).toBeVisible();

  // Buat satu fitur → legenda menampilkan kategori tsb
  await page.locator('.tool[data-tool="Marker"]').click();
  await page.locator('#map').click({ position: { x: 600, y: 300 } });
  await page.waitForTimeout(400);
  await page.locator('#attr-save').click();
  await page.waitForTimeout(300);

  await expect(page.locator('#map-legend')).toBeVisible();
  await expect(page.locator('.legend-item')).toHaveCount(1);

  // Toggle legenda → sembunyi
  await page.locator('#layout-show-legend').uncheck();
  await page.waitForTimeout(200);
  await expect(page.locator('#map-legend')).toHaveClass(/hidden/);
});

test('layout peta: pengaturan tersimpan & dipulihkan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  await page.locator('#layout-title').fill('Peta Tersimpan');
  await page.locator('#layout-show-north').uncheck();
  await page.waitForTimeout(200);

  const stored = await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1'));
  const parsed = JSON.parse(stored);
  expect(parsed.layout.title).toBe('Peta Tersimpan');
  expect(parsed.layout.showNorth).toBe(false);

  // Pulihkan dengan data tersimpan
  await page.addInitScript((data) => {
    localStorage.setItem('delinaisi-maker-v1', data);
  }, stored);
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1500);

  await expect(page.locator('#map-title')).toHaveText('Peta Tersimpan');
  await expect(page.locator('#map-north')).toHaveClass(/hidden/);
});

test('template layout: ganti template mengubah posisi elemen', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.locator('#layout-title').fill('Peta Template');
  await page.locator('#layout-author').fill('Tester');
  await page.waitForTimeout(200);

  // Template "Judul Bawah" → judul pindah ke bawah
  await page.locator('[data-tpl="modal"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#map-wrap')).toHaveClass(/tpl-modal/);
  const titleBox = await page.locator('#map-title').boundingBox();
  expect(titleBox.y).toBeGreaterThan(400);

  // Template "Bersih" → utara & kredit sembunyi
  await page.locator('[data-tpl="bersih"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#map-north')).toHaveClass(/hidden/);
  await expect(page.locator('#map-credit')).toHaveClass(/hidden/);

  // Kembali ke klasik → semua tampil lagi
  await page.locator('[data-tpl="klasik"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#map-north')).not.toHaveClass(/hidden/);

  // Tersimpan
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('delinaisi-maker-v1')).layout.tpl);
  expect(stored).toBe('klasik');
});

/* ============================================================
   Preset ke-5: "Kop Akademik" / Formal
   ============================================================ */

// Helper: isi 3 fitur poligon dengan 3 kategori warna berbeda.
async function seedThreeCategories(page) {
  await page.evaluate(() => {
    const mk = (lls, name, cat) => {
      const layer = L.polygon(lls);
      addFeature({ id: ++idSeq, layer, type: 'Polygon', name, category: cat, desc: '', measure: null }, false);
    };
    mk([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]], 'Kawasan A', 'batas_admin');
    mk([[-6.95,107.60],[-6.95,107.64],[-6.99,107.64],[-6.99,107.60]], 'Kawasan B', 'wilayah_studi');
    mk([[-6.86,107.62],[-6.86,107.66],[-6.90,107.66],[-6.90,107.62]], 'Kawasan C', 'perairan');
    map.fitBounds(drawnItems.getBounds(), { padding: [30, 30] });
  });
  await page.waitForTimeout(500);
}

test('kop akademik: lembar 2 kolom tampil & preset lama tetap utuh', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Aktifkan preset ke-5
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1200);

  // Lembar formal ada, peta utama pindah ke dalamnya
  await expect(page.locator('.formal-sheet')).toHaveCount(1);
  await expect(page.locator('.formal-sheet #map')).toHaveCount(1);

  // Field kop muncul saat preset ini aktif
  await expect(page.locator('#kop-fields')).not.toHaveClass(/hidden/);

  // Panel kanan berada di sebelah kanan peta (2 kolom)
  const mapBox = await page.locator('.fl-map-col').boundingBox();
  const panelBox = await page.locator('.fl-panel').boundingBox();
  expect(panelBox.x).toBeGreaterThan(mapBox.x + mapBox.width - 2);

  // Balik ke preset lama -> lembar dilepas, peta kembali ke #map-wrap
  await page.locator('[data-tpl="klasik"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.formal-sheet')).toHaveCount(0);
  await expect(page.locator('#map-wrap > #map')).toHaveCount(1);
  await expect(page.locator('#kop-fields')).toHaveClass(/hidden/);
});

test('kop akademik: legenda otomatis dari 3 kategori + warna kustom', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await expect(page.locator('#feat-count')).toHaveText('3');

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1300);

  // Legenda ter-generate otomatis: 3 kategori unik
  await expect(page.locator('#fl-legend .fl-legend-item')).toHaveCount(3);
  const labels = await page.locator('#fl-legend .fl-legend-label').allTextContents();
  expect(labels).toContain('Batas Administrasi');
  expect(labels).toContain('Wilayah Studi');
  expect(labels).toContain('Perairan / Sungai');

  // Warna legenda mengikuti warna kategori yang dipakai
  const swatchColor = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#fl-legend .fl-legend-item'))
      .find(r => r.textContent.includes('Wilayah Studi'));
    return getComputedStyle(row.querySelector('.fl-legend-swatch')).backgroundColor;
  });
  expect(swatchColor).toBe('rgb(42, 157, 143)'); // #2a9d8f bawaan

  // Ubah warna lewat pengelola warna -> legenda ikut berubah & tersimpan.
  // Buka panel warna kategori "Wilayah Studi", lalu isi HEX manual.
  await page.locator('.cat-row[data-cat="wilayah_studi"] .cat-swatch').click();
  await page.waitForTimeout(300);
  await page.locator('.cat-row[data-cat="wilayah_studi"] .cat-hex').fill('#ff00aa');
  await page.locator('.cat-row[data-cat="wilayah_studi"] .cat-hex').blur();
  await page.waitForTimeout(500);

  const newColor = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#fl-legend .fl-legend-item'))
      .find(r => r.textContent.includes('Wilayah Studi'));
    return getComputedStyle(row.querySelector('.fl-legend-swatch')).backgroundColor;
  });
  expect(newColor).toBe('rgb(255, 0, 170)');

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('delinaisi-maker-v1')).catColors.wilayah_studi);
  expect(stored).toBe('#ff00aa');
});

test('kop akademik: graticule, skala batang, kompas & diagram lokasi', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);

  // Kanvas graticule terpasang & berukuran
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('#fl-graticule');
    return { w: c.width, h: c.height };
  });
  expect(canvas.w).toBeGreaterThan(100);
  expect(canvas.h).toBeGreaterThan(100);

  // Label koordinat berformat DMS (derajat-menit-detik + hemisphere)
  const dms = await page.evaluate(() => [
    FormalLayout.toDMS(107.25, false),
    FormalLayout.toDMS(-6.9, true)
  ]);
  expect(dms[0]).toBe('107\u00B015\'0"E');
  expect(dms[1]).toBe('6\u00B054\'0"S');

  // Interval graticule menyesuaikan zoom (zoom kabupaten = 10 menit)
  const interval = await page.evaluate(() => FormalLayout.intervalFor(10));
  expect(interval).toBeCloseTo(1 / 6, 5);

  // Skala: label numerik + skala batang bergaya alternating
  await expect(page.locator('#fl-scale-label')).toContainText('SKALA: 1:');
  expect(await page.locator('#fl-scalebar svg rect').count()).toBeGreaterThanOrEqual(4);
  const fills = await page.locator('#fl-scalebar svg rect').evaluateAll(
    els => els.map(e => e.getAttribute('fill')));
  expect(fills).toContain('#111111');
  expect(fills).toContain('#ffffff');
  // Angka di bawah segmen, berawalan 0
  const ticks = await page.locator('#fl-scalebar svg text').allTextContents();
  expect(ticks[0]).toBe('0');

  // Ikon mata angin
  await expect(page.locator('.fl-compass svg')).toHaveCount(1);

  // Inset map (instance Leaflet kedua) + atribusi basemap
  await expect(page.locator('#fl-inset-map.leaflet-container')).toHaveCount(1);
  await expect(page.locator('.fl-inset-attr')).toContainText('Esri');
});

test('kop akademik: bounding box inset mengikuti peta utama', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);

  const boxA = await page.evaluate(() => {
    const b = FormalSheet.insetMap.getBounds();
    return [+b.getSouth().toFixed(4), +b.getWest().toFixed(4)];
  });

  // Geser & zoom peta utama
  await page.evaluate(() => map.setView([-6.95, 107.62], 12, { animate: false }));
  await page.waitForTimeout(900);

  const boxB = await page.evaluate(() => {
    const b = FormalSheet.insetMap.getBounds();
    return [+b.getSouth().toFixed(4), +b.getWest().toFixed(4)];
  });

  // Kotak merah ikut berubah mengikuti cakupan peta utama
  expect(boxA).not.toEqual(boxB);

  // Inset selalu lebih lebar dari peta utama (zoom-out)
  const wider = await page.evaluate(() => {
    const m = map.getBounds(), i = FormalSheet.insetMap.getBounds();
    return (i.getEast() - i.getWest()) > (m.getEast() - m.getWest());
  });
  expect(wider).toBe(true);
});

test('kop akademik: field kop & preset tersimpan setelah reload', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(900);

  await page.locator('#layout-title').fill('PETA DELINASI WILAYAH STUDI');
  await page.locator('#kop-programStudy').fill('Perencanaan Wilayah dan Kota');
  await page.locator('#kop-institution').fill('Universitas Contoh');
  await page.locator('#kop-activityTitle').fill('Studio Perencanaan Wilayah');
  await page.locator('#kop-activityYear').fill('2025');
  await page.locator('#kop-supervisorTitle').fill('Dosen Pembina Studio PWK');
  await page.locator('#kop-mapmakerName').fill('Nama Mahasiswa');
  await page.locator('#kop-mapmakerDegree').fill('S.T.');
  await page.locator('#kop-sourceData').fill('Dinas Pekerjaan Umum');
  await page.waitForTimeout(800);

  // Teks ter-render di panel lembar formal
  await expect(page.locator('#fl-kop-study')).toHaveText('Perencanaan Wilayah dan Kota');
  await expect(page.locator('#fl-kop-inst')).toHaveText('Universitas Contoh');
  await expect(page.locator('#fl-activity')).toContainText('Studio Perencanaan Wilayah');
  await expect(page.locator('#fl-activity')).toContainText('2025');
  await expect(page.locator('#fl-title')).toHaveText('PETA DELINASI WILAYAH STUDI');
  await expect(page.locator('#fl-ref-projection')).toHaveText('Universal Transverse Mercator');
  await expect(page.locator('#fl-ref-datum')).toHaveText('WGS 1984');
  await expect(page.locator('#fl-sign-role')).toHaveText('Dosen Pembina Studio PWK');
  await expect(page.locator('#fl-sign-name')).toContainText('Nama Mahasiswa');
  await expect(page.locator('#fl-sign-name')).toContainText('S.T.');
  await expect(page.locator('#fl-source')).toHaveText('Dinas Pekerjaan Umum');

  // Simpan lalu pulihkan
  const stored = await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1'));
  const parsed = JSON.parse(stored);
  expect(parsed.layout.tpl).toBe('formal');
  expect(parsed.layout.kop.programStudy).toBe('Perencanaan Wilayah dan Kota');
  expect(parsed.layout.kop.supervisorTitle).toBe('Dosen Pembina Studio PWK');

  await page.addInitScript((d) => localStorage.setItem('delinaisi-maker-v1', d), stored);
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Preset formal & seluruh field kop pulih
  await expect(page.locator('.formal-sheet')).toHaveCount(1);
  await expect(page.locator('#kop-programStudy')).toHaveValue('Perencanaan Wilayah dan Kota');
  await expect(page.locator('#kop-supervisorTitle')).toHaveValue('Dosen Pembina Studio PWK');
  await expect(page.locator('#fl-title')).toHaveText('PETA DELINASI WILAYAH STUDI');
});

test('kop akademik: teks generik (tanpa topik hardcode) & ekspor tetap tersedia', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1000);

  // Default generik: proyeksi/datum terisi, topik tidak di-hardcode
  await expect(page.locator('#kop-projection')).toHaveValue('Universal Transverse Mercator');
  await expect(page.locator('#kop-datum')).toHaveValue('WGS 1984');
  const studyVal = await page.locator('#kop-programStudy').inputValue();
  expect(studyVal).toBe('');

  // Tanpa judul -> fallback netral, bukan nama topik tertentu
  await expect(page.locator('#fl-title')).toHaveText('Peta Delinasi');

  // Tombol ekspor masih berfungsi (PaperLayout tersedia)
  const api = await page.evaluate(() => typeof PaperLayout);
  expect(api).toBe('object');

  // Preset lain tidak terpengaruh: 5 tombol preset ada
  await expect(page.locator('#tpl-row button')).toHaveCount(5);
});

test('kop akademik: inset punya grid koordinat & bertahan saat preset ditukar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);

  // Kanvas grid inset ada, berukuran, dan benar-benar tergambar (ada piksel).
  const ink = () => page.evaluate(() => {
    const c = document.querySelector('#fl-inset-graticule');
    if (!c || !c.width) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 3; k < d.length; k += 4) if (d[k] > 0) n++;
    return n;
  });
  expect(await ink()).toBeGreaterThan(0);

  // Tukar preset bolak-balik: inset harus dibangun ulang, bukan hilang.
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-tpl="klasik"]').click();
    await page.waitForTimeout(350);
    await page.locator('[data-tpl="formal"]').click();
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(700);

  await expect(page.locator('.formal-sheet')).toHaveCount(1);
  // Hanya ada SATU peta utama, dan ia berada di dalam lembar formal
  // (bukan lagi anak langsung #map-wrap).
  await expect(page.locator('#map')).toHaveCount(1);
  await expect(page.locator('.formal-sheet #map')).toHaveCount(1);
  await expect(page.locator('#map-wrap > #map')).toHaveCount(0);
  await expect(page.locator('#fl-inset-map.leaflet-container')).toHaveCount(1);
  expect(await ink()).toBeGreaterThan(0);
});

test('kop akademik: tahan resize berulang tanpa error & tetap konsisten', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1500);

  for (const w of [1200, 1000, 1380, 900, 1500]) {
    await page.setViewportSize({ width: w, height: 850 });
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(700);

  // Kanvas menyesuaikan ukuran & tidak ada listener yang menumpuk jadi error.
  const state = await page.evaluate(() => {
    const m = document.querySelector('#fl-graticule');
    const i = document.querySelector('#fl-inset-graticule');
    return {
      mainW: m.width,
      frameW: document.querySelector('.fl-map-frame').clientWidth,
      insetW: i.width,
      insetWrapW: document.querySelector('.fl-inset-wrap').clientWidth,
      legend: document.querySelectorAll('#fl-legend .fl-legend-item').length,
      sheets: document.querySelectorAll('.formal-sheet').length
    };
  });
  expect(state.sheets).toBe(1);
  expect(state.legend).toBe(3);
  expect(state.mainW).toBeGreaterThan(state.frameW - 40);
  expect(state.insetW).toBeGreaterThan(state.insetWrapW - 40);
  expect(errs).toEqual([]);
});

/* ============================================================
   Pengelola warna kategori
   ============================================================ */

test('warna kategori: palet, HEX manual, dan preview', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Buka panel warna kategori pertama
  await page.locator('.cat-row').first().locator('.cat-swatch').click();
  await page.waitForTimeout(300);

  // Panel berisi preview, palet bergrup, dan input HEX
  await expect(page.locator('.cat-preview')).toHaveCount(1);
  await expect(page.locator('.cat-palette-group')).toHaveCount(6);
  expect(await page.locator('.cat-palette-dot').count()).toBeGreaterThanOrEqual(40);
  await expect(page.locator('.cat-hex')).toHaveValue('#e63946');

  // Pilih dari palet -> HEX & swatch ikut berubah
  await page.locator('.cat-palette-dot').nth(9).click();
  await page.waitForTimeout(400);
  const afterPalette = await page.locator('.cat-hex').inputValue();
  expect(afterPalette).toMatch(/^#[0-9a-f]{6}$/);
  const swatchBg = await page.locator('.cat-row').first().locator('.cat-swatch')
    .evaluate(e => getComputedStyle(e).backgroundColor);
  expect(swatchBg).not.toBe('rgb(230, 57, 70)');

  // HEX manual (dengan/tanpa '#') diterima & dinormalisasi
  await page.locator('.cat-hex').fill('1B998B');
  await page.locator('.cat-hex').blur();
  await page.waitForTimeout(400);
  await expect(page.locator('.cat-hex')).toHaveValue('#1b998b');

  // HEX tidak valid ditolak, nilai lama dipertahankan
  await page.locator('.cat-hex').fill('bukan-warna');
  await page.locator('.cat-hex').blur();
  await page.waitForTimeout(400);
  await expect(page.locator('.cat-hex')).toHaveValue('#1b998b');

  // Tersimpan
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('delinaisi-maker-v1')).catColors.batas_admin);
  expect(stored).toBe('#1b998b');
});

test('warna kategori: ganti nama ikut ke dropdown & legenda', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1300);

  // Ganti nama kategori yang sedang dipakai
  const nameInput = page.locator('.cat-row[data-cat="wilayah_studi"] .cat-name-input');
  await nameInput.fill('Zona Industri');
  await nameInput.blur();
  await page.waitForTimeout(700);

  // Nama baru muncul di legenda lembar formal
  const labels = await page.locator('#fl-legend .fl-legend-label').allTextContents();
  expect(labels).toContain('Zona Industri');
  expect(labels).not.toContain('Wilayah Studi');

  // Dan di dropdown modal detail fitur
  await page.locator('.feat').first().locator('.icon-btn[data-act="edit"]').click();
  await page.waitForTimeout(500);
  const opts = await page.locator('#attr-category option').allTextContents();
  expect(opts).toContain('Zona Industri');
  await page.locator('#attr-cancel').click();
});

test('warna kategori: tambah, hapus, dan peringatan warna kembar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const before = await page.locator('.cat-row').count();
  expect(before).toBe(7);

  // Tambah kategori baru -> otomatis dapat warna yang belum terpakai
  await page.locator('#btn-cat-add').click();
  await page.waitForTimeout(500);
  expect(await page.locator('.cat-row').count()).toBe(before + 1);

  const newRow = page.locator('.cat-row').last();
  const newColor = await newRow.locator('.cat-swatch')
    .evaluate(e => getComputedStyle(e).backgroundColor);

  // Paksa warna sama dengan kategori lain -> muncul peringatan.
  // Kategori baru sudah otomatis membuka panelnya, jadi jangan klik dua kali.
  if (!(await newRow.evaluate(e => e.classList.contains('open')))) {
    await newRow.locator('.cat-swatch').click();
    await page.waitForTimeout(300);
  }
  await newRow.locator('.cat-hex').fill('#e63946');
  await newRow.locator('.cat-hex').blur();
  await page.waitForTimeout(500);

  await expect(page.locator('#cat-dupe-warn')).toBeVisible();
  await expect(page.locator('#cat-dupe-warn')).toContainText('Warna sama');
  expect(await page.locator('.cat-swatch-warn').count()).toBeGreaterThanOrEqual(2);

  // Kategori yang belum dipakai bisa dihapus
  await newRow.locator('.cat-del').click();
  await page.waitForTimeout(500);
  expect(await page.locator('.cat-row').count()).toBe(before);

  // Kategori yang sedang dipakai tidak bisa dihapus
  await page.evaluate(() => {
    const l = L.polygon([[-6.9,107.58],[-6.9,107.62],[-6.93,107.62],[-6.93,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: 'A',
                 category: 'batas_admin', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(700);
  await expect(page.locator('.cat-row[data-cat="batas_admin"] .cat-del')).toBeDisabled();
  await expect(page.locator('.cat-row[data-cat="batas_admin"] .cat-count')).toHaveText('1 fitur');
});

test('warna kategori: kategori kustom bertahan setelah reload', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Tambah kategori + beri nama & warna
  await page.locator('#btn-cat-add').click();
  await page.waitForTimeout(400);
  const row = page.locator('.cat-row').last();
  await row.locator('.cat-name-input').fill('Kawasan Hutan');
  await row.locator('.cat-name-input').blur();
  await page.waitForTimeout(300);
  if (!(await row.evaluate(e => e.classList.contains('open')))) {
    await row.locator('.cat-swatch').click();
    await page.waitForTimeout(300);
  }
  await row.locator('.cat-hex').fill('#2d6a4f');
  await row.locator('.cat-hex').blur();
  await page.waitForTimeout(600);

  const stored = await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1'));
  const parsed = JSON.parse(stored);
  expect(parsed.categories.some(c => c.label === 'Kawasan Hutan' && c.color === '#2d6a4f')).toBe(true);

  await page.addInitScript((d) => localStorage.setItem('delinaisi-maker-v1', d), stored);
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1500);

  expect(await page.locator('.cat-row').count()).toBe(8);
  const names = await page.locator('.cat-name-input').evaluateAll(els => els.map(e => e.value));
  expect(names).toContain('Kawasan Hutan');
  const colors = await page.locator('.cat-swatch').evaluateAll(
    els => els.map(e => getComputedStyle(e).backgroundColor));
  expect(colors).toContain('rgb(45, 106, 79)');
});

test('warna kategori: reset memulihkan bawaan tapi kategori kustom tetap ada', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Ubah warna bawaan + tambah kategori kustom
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-swatch').click();
  await page.waitForTimeout(300);
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-hex').fill('#123456');
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-hex').blur();
  await page.waitForTimeout(400);
  await page.locator('#btn-cat-add').click();
  await page.waitForTimeout(400);

  // Reset
  await page.locator('#btn-cat-reset').click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => ({
    warnaBawaan: CATEGORIES.find(c => c.id === 'batas_admin').color,
    jumlah: CATEGORIES.length,
    masihAdaKustom: CATEGORIES.some(c => c.id.startsWith('kustom_'))
  }));
  expect(state.warnaBawaan).toBe('#e63946');
  expect(state.masihAdaKustom).toBe(true);
  expect(state.jumlah).toBe(8);
});

/* ============================================================
   Peta dasar tanpa API key
   ============================================================ */

test('peta dasar: semua pilihan tanpa API key & benar-benar memuat ubin', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Tidak ada URL ubin yang menyisipkan kunci/token.
  const urls = await page.evaluate(() => Object.keys(BASEMAPS).map(k => BASEMAPS[k]._url || ''));
  expect(urls.length).toBeGreaterThanOrEqual(8);
  urls.forEach(u => {
    expect(u).not.toMatch(/api[_-]?key|access[_-]?token|apikey|\{key\}|apikey=/i);
  });

  // Penyedia yang butuh kunci tidak boleh didaftarkan.
  const joined = urls.join(' ');
  expect(joined).not.toMatch(/stadiamaps|mapbox|thunderforest|maptiler|tomtom|here\.com/i);

  // Jumlah tombol = jumlah peta dasar yang terdaftar.
  expect(await page.locator('#basemap-row button').count()).toBe(urls.length);

  // Setiap pilihan harus bisa diaktifkan; yang punya ubin harus memuatnya.
  const ids = await page.evaluate(() => Object.keys(BASEMAPS));
  for (const id of ids) {
    await page.locator(`[data-basemap="${id}"]`).click();
    await page.waitForTimeout(900);
    const st = await page.evaluate((bid) => ({
      aktif: currentBasemap === bid,
      loaded: document.querySelectorAll('#map .leaflet-tile-loaded').length
    }), id);
    expect(st.aktif).toBe(true);
    // Server ubin publik bisa lambat; tunggu sebentar alih-alih menuntut
    // hasil dalam satu jendela waktu yang kaku (dulu membuat test flaky).
    if (id !== 'none') {
      await expect
        .poll(() => page.evaluate(() =>
          document.querySelectorAll('#map .leaflet-tile-loaded').length),
          { timeout: 15000, message: 'ubin ' + id + ' tidak termuat' })
        .toBeGreaterThan(0);
    }
  }

  expect(errs).toEqual([]);
});

test('peta dasar: "Sumber data" ikut berubah sesuai pilihan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Atribusi harus mencerminkan penyedia yang aktif, bukan nilai basi.
  await page.locator('[data-basemap="terrain"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#map-credit-source')).toContainText('Esri');

  await page.locator('[data-basemap="topo"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#map-credit-source')).toContainText('OpenTopoMap');

  await page.locator('[data-basemap="streets"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#map-credit-source')).toContainText('OpenStreetMap');

  // Ikut tersimpan & terbawa ke ekspor GeoJSON
  const meta = await page.evaluate(() => {
    localStorage.setItem('__probe', '1');
    return basemapAttribution(currentBasemap);
  });
  expect(meta).toContain('OpenStreetMap');
});

test('peta dasar: mode "Kosong" tetap bisa menggambar & inset tetap hidup', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('[data-basemap="none"]').click();
  await page.waitForTimeout(900);

  // Tidak ada ubin, tapi peta tetap ada dan bisa menampung fitur.
  expect(await page.locator('#map .leaflet-tile').count()).toBe(0);
  await page.evaluate(() => {
    const l = L.polygon([[-6.9,107.58],[-6.9,107.65],[-6.95,107.65],[-6.95,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: 'A',
                 category: 'batas_admin', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(600);
  await expect(page.locator('#feat-count')).toHaveText('1');
  expect(await page.locator('#map path').count()).toBeGreaterThan(0);

  // Preset formal: inset tidak boleh ikut kosong, tetap pakai sumber terang.
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);
  expect(await page.locator('#fl-inset-map .leaflet-tile').count()).toBeGreaterThan(0);
});

/* ============================================================
   Batas administrasi (lapisan terpisah, Nominatim tanpa API key)
   ============================================================ */

// Data tiruan: meniru bentuk respons Nominatim, termasuk jebakan
// "Kantor Kecamatan" (bangunan) yang harus ditolak filter.
const NOMINATIM_FIXTURE = [
  {
    display_name: 'Kantor Kecamatan Cibinong, Jalan HR Lukman, Indonesia',
    name: 'Kantor Kecamatan Cibinong',
    category: 'government', type: 'government', place_rank: 30,
    osm_type: 'way', osm_id: 111,
    geojson: { type: 'Polygon', coordinates: [[[106.8,-6.4],[106.81,-6.4],[106.81,-6.41],[106.8,-6.41],[106.8,-6.4]]] }
  },
  {
    display_name: 'Bogor, Jawa Barat, Indonesia',
    name: 'Bogor',
    category: 'boundary', type: 'administrative', place_rank: 12,
    osm_type: 'relation', osm_id: 14762112,
    geojson: {
      type: 'Polygon',
      coordinates: [Array.from({ length: 60 }, (_, i) => [106.7 + i * 0.001, -6.5])]
    }
  },
  {
    display_name: 'Cibinong, Bogor, Jawa Barat, Indonesia',
    name: 'Cibinong',
    category: 'boundary', type: 'administrative', place_rank: 14,
    osm_type: 'relation', osm_id: 19957699,
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[Array.from({ length: 40 }, (_, i) => [106.8 + i * 0.001, -6.48])]]
    }
  }
];

async function mockNominatim(page) {
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(NOMINATIM_FIXTURE)
    });
  });
}

test('batas administrasi: filter menolak bangunan, hanya terima batas asli', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const r = await page.evaluate(() => {
    const kantor = { category: 'government', type: 'government',
      geojson: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } };
    const tanpaGeom = { category: 'boundary', type: 'administrative', geojson: null };
    const garis = { category: 'boundary', type: 'administrative',
      geojson: { type: 'LineString', coordinates: [[0,0],[1,1]] } };
    const asli = { category: 'boundary', type: 'administrative',
      geojson: { type: 'Polygon', coordinates: [Array.from({length:50},(_,i)=>[106+i*0.001,-6.5])] } };
    const terlaluKecil = { category: 'boundary', type: 'administrative',
      geojson: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } };
    return {
      kantor: AdminBoundaries.isRealBoundary(kantor),
      tanpaGeom: AdminBoundaries.isRealBoundary(tanpaGeom),
      garis: AdminBoundaries.isRealBoundary(garis),
      asli: AdminBoundaries.isRealBoundary(asli),
      terlaluKecil: AdminBoundaries.isRealBoundary(terlaluKecil)
    };
  });
  expect(r.kantor).toBe(false);
  expect(r.tanpaGeom).toBe(false);
  expect(r.garis).toBe(false);
  expect(r.asli).toBe(true);
  expect(r.terlaluKecil).toBe(false);
});

test('batas administrasi: cari, muat, toggle, dan hapus', async ({ page }) => {
  await mockNominatim(page);
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('#admin-q').fill('Bogor');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1500);

  // Hanya 2 batas asli yang lolos (bangunan kantor ditolak)
  await expect(page.locator('.admin-item')).toHaveCount(2);
  await expect(page.locator('#admin-status')).toContainText('2 batas ditemukan');

  // Muat batas pertama
  await page.locator('.admin-item').first().click();
  await page.waitForTimeout(1200);

  await expect(page.locator('#admin-loaded')).not.toHaveClass(/hidden/);
  await expect(page.locator('#admin-loaded-meta')).toContainText('Kabupaten/Kota');
  expect(await page.evaluate(() => AdminBoundaries.hasData())).toBe(true);
  await expect(page.locator('#admin-show')).toBeChecked();

  // Toggle sembunyikan / tampilkan
  await page.locator('#admin-show').uncheck();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => {
    let visible = false;
    map.eachLayer(l => { if (l.options && l.options.dashArray === '6 4' && map.hasLayer(l)) visible = true; });
    return visible;
  })).toBe(false);

  await page.locator('#admin-show').check();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => {
    let visible = false;
    map.eachLayer(l => { if (l.options && l.options.dashArray === '6 4' && map.hasLayer(l)) visible = true; });
    return visible;
  })).toBe(true);

  // Hapus
  await page.locator('#admin-clear').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => AdminBoundaries.hasData())).toBe(false);
  await expect(page.locator('#admin-loaded')).toHaveClass(/hidden/);
});

test('batas administrasi: tidak autocomplete & kueri ulang pakai cache', async ({ page }) => {
  let calls = 0;
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    calls++;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(NOMINATIM_FIXTURE) });
  });

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Mengetik TIDAK boleh memicu permintaan (Nominatim melarang autocomplete)
  await page.locator('#admin-q').pressSequentially('Bogor', { delay: 120 });
  await page.waitForTimeout(1800);
  expect(calls).toBe(0);

  // Tombol memicu satu permintaan
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1500);
  expect(calls).toBe(1);

  // Kueri sama lagi -> dari cache, tidak ada permintaan baru
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1200);
  expect(calls).toBe(1);
  await expect(page.locator('#admin-status')).toContainText('cache');
});

test('batas administrasi: terpisah dari delinasi & masuk legenda formal', async ({ page }) => {
  await mockNominatim(page);
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('#admin-q').fill('Bogor');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1200);
  await page.locator('.admin-item').first().click();
  await page.waitForTimeout(1200);

  // Batas administrasi BUKAN fitur delinasi user
  await expect(page.locator('#feat-count')).toHaveText('0');

  // User tetap bisa menggambar di atasnya
  await seedThreeCategories(page);
  await expect(page.locator('#feat-count')).toHaveText('3');

  // Legenda lembar formal memuat keduanya
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);
  const groups = await page.locator('#fl-legend .fl-legend-sub').allTextContents();
  expect(groups).toContain('Batas Administrasi');
  const labels = await page.locator('#fl-legend .fl-legend-label').allTextContents();
  expect(labels).toContain('Bogor');
  expect(labels).toContain('Batas Administrasi'); // kategori delinasi user
});

test('batas administrasi: status jelas saat gagal & saat kueri terlalu pendek', async ({ page }) => {
  await page.route('**/nominatim.openstreetmap.org/**', route => route.abort());

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Kueri terlalu pendek ditolak lebih dulu
  await page.locator('#admin-q').fill('Bo');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#admin-status')).toContainText('minimal 3 huruf');

  // Gagal jaringan -> pesan ramah, bukan crash
  await page.locator('#admin-q').fill('Bogor');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(2000);
  await expect(page.locator('#admin-status')).toHaveClass(/is-error/);
  await expect(page.locator('#admin-status')).toContainText('Gagal mencari');
});

test('batas administrasi: legenda formal tetap terisi walau belum ada fitur', async ({ page }) => {
  await mockNominatim(page);
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Tanpa satu pun fitur delinasi, muat batas administrasi saja
  await expect(page.locator('#feat-count')).toHaveText('0');
  await page.locator('#admin-q').fill('Bogor');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1200);
  await page.locator('.admin-item').first().click();
  await page.waitForTimeout(1200);

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);

  // Batas tetap dijelaskan di legenda (bukan "Belum ada fitur")
  await expect(page.locator('#fl-legend .fl-legend-empty')).toHaveCount(0);
  await expect(page.locator('#fl-legend .fl-legend-sub')).toHaveCount(1);
  await expect(page.locator('#fl-legend .fl-legend-sub')).toHaveText('Batas Administrasi');
  await expect(page.locator('#fl-legend .fl-legend-label')).toHaveText('Bogor');
});

test('batas administrasi: awalan tingkat dibuang agar pencarian berhasil', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Di OSM relasi batas Indonesia bernama polos ("Cibinong"), sehingga
  // awalan "Kecamatan"/"Kabupaten" membuat pencarian gagal. Harus dibuang.
  const r = await page.evaluate(() => ({
    kec: AdminBoundaries.cleanQuery('Kecamatan Cibinong'),
    kab: AdminBoundaries.cleanQuery('Kabupaten Bogor'),
    kel: AdminBoundaries.cleanQuery('Kelurahan Sukamaju'),
    desa: AdminBoundaries.cleanQuery('Desa Sukamaju'),
    prov: AdminBoundaries.cleanQuery('Provinsi Jawa Barat'),
    kota: AdminBoundaries.cleanQuery('Kota Bandung'),
    ganda: AdminBoundaries.cleanQuery('Kecamatan Kelurahan X'),
    polos: AdminBoundaries.cleanQuery('Cibinong, Bogor')
  }));
  expect(r.kec).toBe('Cibinong');
  expect(r.kab).toBe('Bogor');
  expect(r.kel).toBe('Sukamaju');
  expect(r.desa).toBe('Sukamaju');
  expect(r.prov).toBe('Jawa Barat');
  expect(r.kota).toBe('Bandung');
  expect(r.ganda).toBe('X');
  // Nama tanpa awalan dibiarkan apa adanya
  expect(r.polos).toBe('Cibinong, Bogor');

  // Kueri yang dikirim ke server sudah bersih
  const sent = [];
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    const u = decodeURIComponent(route.request().url());
    const m = u.match(/q=([^&]*)/);
    if (m) sent.push(m[1]);
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(NOMINATIM_FIXTURE) });
  });
  await page.locator('#admin-q').fill('Kecamatan Cibinong');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1500);
  expect(sent).toEqual(['Cibinong']);
  expect(await page.locator('.admin-item').count()).toBeGreaterThan(0);
});

test('batas administrasi: pesan bantuan muncul saat tidak ada hasil', async ({ page }) => {
  await page.route('**/nominatim.openstreetmap.org/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]'
  }));

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('#admin-q').fill('Kecamatan Tidak Ada');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(1500);

  const status = page.locator('#admin-status');
  await expect(status).toContainText('Tidak ditemukan');
  await expect(status).toContainText('Tidak Ada');       // kueri bersih disebut
  await expect(status).toContainText('OpenStreetMap');   // saran penulisan
  await expect(page.locator('.admin-empty')).toHaveCount(1);
});

/* ============================================================
   Logo instansi & posisi teks lembar formal
   ============================================================ */

// PNG kecil yang valid, dibuat di dalam test (tanpa file eksternal).
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/3gAoAAAAFElEQVR4nGP4z8Dwn4GBgYGBgQEAFQIC/8Q5MgAAAAAASUVORK5CYII=';

test('logo instansi: unggah, tampil di lembar, dan hapus', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1200);

  // Awal: placeholder, tombol hapus nonaktif
  await expect(page.locator('.fl-kop-logo svg')).toHaveCount(1);
  await expect(page.locator('#logo-remove-btn')).toBeDisabled();

  // Unggah
  await page.setInputFiles('#logo-input', {
    name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64')
  });
  await page.waitForTimeout(1500);

  // Muncul di pratinjau sidebar DAN di lembar formal
  await expect(page.locator('#logo-preview img')).toHaveCount(1);
  await expect(page.locator('.fl-kop-logo img')).toHaveCount(1);
  await expect(page.locator('.fl-kop-logo svg')).toHaveCount(0);
  await expect(page.locator('#logo-remove-btn')).toBeEnabled();

  // Placeholder tidak lagi punya bingkai; logo asli tampil bersih
  const hasLogoClass = await page.locator('.fl-kop-logo').evaluate(e => e.classList.contains('has-logo'));
  expect(hasLogoClass).toBe(true);

  // Hapus
  await page.locator('#logo-remove-btn').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.fl-kop-logo img')).toHaveCount(0);
  await expect(page.locator('.fl-kop-logo svg')).toHaveCount(1);
  await expect(page.locator('#logo-remove-btn')).toBeDisabled();
});

test('logo instansi: tersimpan sebagai data URL & pulih setelah reload', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1000);
  await page.setInputFiles('#logo-input', {
    name: 'logo-instansi.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64')
  });
  await page.waitForTimeout(1500);

  const stored = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('delinaisi-maker-v1'));
    return { logo: d.layout.kop.logo || '', nama: d.layout.kop.logoName };
  });
  expect(stored.logo).toMatch(/^data:image\/png;base64,/);
  expect(stored.nama).toBe('logo-instansi.png');

  await page.addInitScript((d) => localStorage.setItem('delinaisi-maker-v1', d),
    await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1')));
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  await expect(page.locator('.fl-kop-logo img')).toHaveCount(1);
  await expect(page.locator('#logo-preview img')).toHaveCount(1);
});

test('logo instansi: tolak file bukan gambar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1000);

  await page.setInputFiles('#logo-input', {
    name: 'dokumen.txt', mimeType: 'text/plain', buffer: Buffer.from('bukan gambar')
  });
  await page.waitForTimeout(1000);

  // Logo tidak berubah & ada pemberitahuan
  expect(await page.evaluate(() => (layout.kop.logo || '').length)).toBe(0);
  await expect(page.locator('#toast')).toContainText('Format logo');
});

test('lembar formal: posisi teks sesuai tata letak kop', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1200);

  await page.locator('#layout-title').fill('PETA DELINASI WILAYAH STUDI');
  await page.locator('#kop-programStudy').fill('Perencanaan Wilayah dan Kota');
  await page.locator('#kop-institution').fill('Universitas Contoh');
  await page.waitForTimeout(900);

  const align = await page.evaluate(() => ({
    kop: getComputedStyle(document.querySelector('.fl-kop')).textAlign,
    activity: getComputedStyle(document.querySelector('.fl-activity')).textAlign,
    title: getComputedStyle(document.querySelector('.fl-title')).textAlign
  }));
  // Kop rata kiri sejajar logo; judul kegiatan & judul peta di tengah
  expect(align.kop).toBe('left');
  expect(align.activity).toBe('center');
  expect(align.title).toBe('center');

  // Kop: logo di kiri teks, sejajar
  const kop = await page.evaluate(() => {
    const l = document.querySelector('.fl-kop-logo').getBoundingClientRect();
    const t = document.querySelector('.fl-kop-text').getBoundingClientRect();
    return { logoKiri: l.left < t.left, sejajar: Math.abs(l.top - t.top) < 40 };
  });
  expect(kop.logoKiri).toBe(true);
  expect(kop.sejajar).toBe(true);

  // Blok pengesahan berada di sisi KANAN panel (kolom tanda tangan)
  // Yang penting: blok tanda tangan menempel ke sisi KANAN panel, dengan
  // lebar terbatas (kolom tanda tangan), bukan melebar penuh.
  const sign = await page.evaluate(() => {
    const s = document.querySelector('.fl-sign').getBoundingClientRect();
    const b = document.querySelector('.fl-block--sign').getBoundingClientRect();
    const p = document.querySelector('.fl-panel').getBoundingClientRect();
    return {
      jarakKanan: Math.round(p.right - s.right),
      jarakKiri: Math.round(s.left - p.left),
      lebar: Math.round(s.width),
      lebarPanel: Math.round(p.width),
      rataKanan: Math.abs(b.right - s.right) < 24
    };
  });
  expect(sign.rataKanan).toBe(true);
  expect(sign.jarakKanan).toBeLessThan(30);   // menempel kanan
  expect(sign.jarakKiri).toBeGreaterThan(40); // ada ruang kosong di kiri
  expect(sign.lebar).toBeGreaterThan(120);
  expect(sign.lebar).toBeLessThan(sign.lebarPanel);

  // Urutan blok tetap sesuai standar kop
  const urutan = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.fl-panel > .fl-block'))
      .map(b => Math.round(b.getBoundingClientRect().y)));
  const menaik = urutan.every((y, i) => i === 0 || y >= urutan[i - 1]);
  expect(menaik).toBe(true);
});

/* ============================================================
   Transparansi: tidak terlalu bening, tidak terlalu pekat
   ============================================================ */

test('transparansi: isian poligon tetap terlihat tanpa menutupi peta dasar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.waitForTimeout(800);

  const s = await page.evaluate(() => features
    .filter(f => f.type === 'Polygon')
    .map(f => ({ fill: f.layer.options.fillOpacity, stroke: f.layer.options.opacity })));

  expect(s.length).toBe(3);
  s.forEach(v => {
    // Terlalu bening (<0.2) membuat delinasi tak terlihat saat dicetak;
    // terlalu pekat (>0.5) menutupi peta dasar sehingga konteks hilang.
    expect(v.fill).toBeGreaterThanOrEqual(0.2);
    expect(v.fill).toBeLessThanOrEqual(0.5);
    // Garis tepi harus tegas karena inilah yang membuat poligon terbaca.
    expect(v.stroke).toBeGreaterThanOrEqual(0.9);
  });
});

test('transparansi: halo putih menjaga keterbacaan di basemap gelap', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Poligon (dapat halo) + garis (dapat halo) + titik (tanpa halo)
  await page.evaluate(() => {
    const poly = L.polygon([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]]);
    addFeature({ id: ++idSeq, layer: poly, type: 'Polygon', name: 'A',
                 category: 'daerah_pemilihan', desc: '', measure: null }, false);
    const line = L.polyline([[-6.85,107.55],[-6.85,107.62]]);
    addFeature({ id: ++idSeq, layer: line, type: 'Polyline', name: 'J',
                 category: 'jaringan_jalan', desc: '', measure: null }, false);
    const pt = L.marker([-6.88,107.70]);
    addFeature({ id: ++idSeq, layer: pt, type: 'Marker', name: 'T',
                 category: 'lainnya', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(900);

  const halo = await page.evaluate(() => ({
    jumlah: map.__haloGroup ? map.__haloGroup.getLayers().length : 0,
    warna: map.__haloGroup ? map.__haloGroup.getLayers().map(l => l.options.color) : [],
    // Poligon/garis dapat halo; titik & lingkaran tidak
    adaIsian: map.__haloGroup ? map.__haloGroup.getLayers().map(l => l.options.fill) : []
  }));
  expect(halo.jumlah).toBe(2);
  halo.warna.forEach(c => expect(c).toBe('#ffffff'));
  halo.adaIsian.forEach(f => expect(f).toBe(false));  // hanya garis, tanpa isian

  // Halo berada DI BAWAH fitur sehingga tidak menutupi warnanya
  const urutan = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('#map path'));
    const iHalo = paths.findIndex(e => e.getAttribute('stroke') === '#ffffff');
    const iFitur = paths.findIndex(e => {
      const st = e.getAttribute('stroke');
      return st && st !== '#ffffff';
    });
    return { iHalo, iFitur };
  });
  expect(urutan.iHalo).toBeGreaterThanOrEqual(0);
  expect(urutan.iHalo).toBeLessThan(urutan.iFitur);

  // Hapus fitur -> halo ikut bersih (tidak ada sisa garis putih)
  await page.evaluate(() => deleteFeature(features[0].id));
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => map.__haloGroup.getLayers().length)).toBe(1);
});

test('transparansi: atribusi inset & kotak cakupan tidak ekstrem', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);

  // Atribusi: harus terbaca (cukup pekat) tapi tidak menutupi peta inset
  const alpha = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector('.fl-inset-attr')).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m[1].split(',').map(v => parseFloat(v));
    return parts.length === 4 ? parts[3] : 1;
  });
  expect(alpha).toBeGreaterThanOrEqual(0.65);   // jangan terlalu bening
  expect(alpha).toBeLessThanOrEqual(0.9);       // jangan terlalu pekat

  // Kotak merah cakupan: harus terlihat jelas di atas peta inset
  const box = await page.evaluate(() => {
    let o = null;
    FormalSheet.insetMap.eachLayer(l => {
      if (l.options && l.options.fillColor === '#e01b1b') o = l.options.fillOpacity;
    });
    return o;
  });
  expect(box).toBeGreaterThanOrEqual(0.12);     // dulu 0.10 -> praktis tak terlihat
  expect(box).toBeLessThanOrEqual(0.35);        // jangan menutupi peta inset
});

/* ============================================================
   Diagram lokasi (inset) yang bisa dikustom
   ============================================================ */

// Setiap field #kop-* harus benar-benar terpasang ke state. Ini menjaga
// bug lama: nama field camelCase vs id kebab-case membuat beberapa field
// diam-diam terlewat tanpa error.
test('inset: setiap kontrol terpasang ke state (id tidak mismatch)', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1200);

  // Semua id yang dipakai KOP_FIELDS harus ada di DOM
  const missing = await page.evaluate(() => KOP_FIELDS
    .filter(({ id }) => !document.querySelector('#' + id))
    .map(({ id }) => id));
  expect(missing).toEqual([]);

  // Ubah tiap kontrol, pastikan nilai sampai ke state
  const cases = [
    ['#kop-inset-basemap', 'satellite', 'insetBasemap'],
    ['#kop-inset-zoom',    '8',         'insetZoom'],
    ['#kop-inset-height',  '200',       'insetHeight'],
    ['#kop-inset-grid',    '0',         'insetGrid'],
    ['#kop-programStudy',  'PWK',       'programStudy']
  ];
  for (const [sel, val, key] of cases) {
    await page.locator(sel).selectOption(val).catch(async () => {
      await page.locator(sel).fill(val);
    });
    await page.waitForTimeout(350);
    expect(await page.evaluate(k => layout.kop[k], key)).toBe(val);
  }

  // Input warna
  await page.evaluate(() => {
    const c = document.querySelector('#kop-inset-color');
    c.value = '#1d4ed8';
    c.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => layout.kop.insetColor)).toBe('#1d4ed8');
});

test('inset: peta dasar, tinggi, grid, judul & kotak cakupan bisa diubah', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);

  const snap = () => page.evaluate(() => ({
    tinggi: Math.round(document.querySelector('.fl-inset-wrap').getBoundingClientRect().height),
    judul: document.querySelector('.fl-inset-head').textContent,
    kotak: (() => { let v = null; FormalSheet.insetMap.eachLayer(l => {
      if (l.options && l.options.fillColor) v = l.options.fillColor; }); return v; })(),
    grid: getComputedStyle(document.querySelector('#fl-inset-graticule')).display !== 'none',
    url: (() => { let u = null; FormalSheet.insetMap.eachLayer(l => { if (l._url) u = l._url; }); return u; })()
  }));

  const a = await snap();
  expect(a.tinggi).toBe(150);
  expect(a.judul).toBe('Diagram Lokasi:');
  expect(a.grid).toBe(true);

  // Ubah semuanya
  await page.locator('#kop-inset-basemap').selectOption('satellite');
  await page.waitForTimeout(900);
  await page.locator('#kop-inset-height').selectOption('200');
  await page.waitForTimeout(500);
  await page.locator('#kop-inset-grid').selectOption('0');
  await page.waitForTimeout(500);
  await page.locator('#kop-inset-label').fill('LOKASI KAJIAN');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const c = document.querySelector('#kop-inset-color');
    c.value = '#1d4ed8';
    c.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(800);

  const b = await snap();
  expect(b.tinggi).toBe(200);
  expect(b.judul).toBe('LOKASI KAJIAN');
  expect(b.kotak.toLowerCase()).toBe('#1d4ed8');
  expect(b.grid).toBe(false);
  expect(b.url).not.toBe(a.url);                 // ubin inset benar-benar berganti
  expect(b.url).toContain('arcgisonline');       // satelit
});

test('inset: bisa disembunyikan & opsi tersimpan setelah reload', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);

  await page.locator('#kop-inset-label').fill('PETA LOKASI');
  await page.locator('#kop-inset-height').selectOption('110');
  await page.waitForTimeout(600);

  // Sembunyikan
  await page.locator('#kop-inset-show').uncheck();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('.fl-inset-block')).display)).toBe('none');

  // Tampilkan lagi
  await page.locator('#kop-inset-show').check();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('.fl-inset-block')).display)).not.toBe('none');

  const stored = await page.evaluate(() => JSON.parse(
    localStorage.getItem('delinaisi-maker-v1')).layout.kop);
  expect(stored.insetLabel).toBe('PETA LOKASI');
  expect(stored.insetHeight).toBe('110');

  await page.addInitScript((d) => localStorage.setItem('delinaisi-maker-v1', d),
    await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1')));
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2200);

  await expect(page.locator('#kop-inset-label')).toHaveValue('PETA LOKASI');
  await expect(page.locator('#kop-inset-height')).toHaveValue('110');
  await expect(page.locator('.fl-inset-head')).toHaveText('PETA LOKASI');
  expect(await page.evaluate(() =>
    Math.round(document.querySelector('.fl-inset-wrap').getBoundingClientRect().height))).toBe(110);
});

test('inset: mode "sama dengan peta utama" ikut berubah saat peta dasar diganti', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);

  await page.locator('#kop-inset-basemap').selectOption('follow');
  await page.waitForTimeout(900);

  const urls = () => page.evaluate(() => ({
    utama: BASEMAPS[currentBasemap]._url,
    inset: (() => { let u = null; FormalSheet.insetMap.eachLayer(l => { if (l._url) u = l._url; }); return u; })()
  }));

  // Ganti peta dasar utama -> inset harus mengikuti
  await page.locator('[data-basemap="terrain"]').click();
  await page.waitForTimeout(1500);
  let u = await urls();
  expect(u.inset).toBe(u.utama);
  expect(u.inset).toContain('World_Topo_Map');

  await page.locator('[data-basemap="dark"]').click();
  await page.waitForTimeout(1500);
  u = await urls();
  expect(u.inset).toBe(u.utama);

  // Mode 'none' pada peta utama: inset jatuh ke Minimal supaya tetap terlihat
  await page.locator('[data-basemap="none"]').click();
  await page.waitForTimeout(1500);
  u = await urls();
  expect(u.inset).not.toBe('');
  expect(u.inset).toContain('cartocdn');
});

/* ============================================================
   Graticule tidak boleh keluar batas (terutama saat ekspor PNG)
   ============================================================ */

test('graticule: label tidak terpotong di semua tingkat zoom', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1600);

  // Diuji di beberapa zoom: label di tepi paling rawan terpotong saat
  // lembar diekspor ke PNG.
  for (const [z, lat, lng] of [[3, -2.5, 118], [5, -2.5, 118], [8, -6.9, 107.6],
                               [10, -6.9, 107.6], [13, -6.9, 107.6]]) {
    const tepi = await page.evaluate(({ z, lat, lng }) => {
      map.setView([lat, lng], z, { animate: false });
      FormalSheet.refresh();
      const c = document.querySelector('#fl-graticule');
      const ctx = c.getContext('2d');
      const W = c.width, H = c.height;
      const hitung = (x0, y0, w, h) => {
        const d = ctx.getImageData(x0, y0, w, h).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      };
      return {
        kiri: hitung(0, 0, 1, H), kanan: hitung(W - 1, 0, 1, H),
        atas: hitung(0, 0, W, 1), bawah: hitung(0, H - 1, W, 1),
        // Label harus tetap tergambar (tidak hilang karena dijepit)
        adaTinta: hitung(0, 0, W, H)
      };
    }, { z, lat, lng });

    expect(tepi.kiri).toBe(0);
    expect(tepi.kanan).toBe(0);
    expect(tepi.atas).toBe(0);
    expect(tepi.bawah).toBe(0);
    expect(tepi.adaTinta).toBeGreaterThan(0);   // bukan kosong
  }
});

test('graticule: nilai koordinat dinormalisasi (tidak ada 190°E)', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const r = await page.evaluate(() => ({
    lng190: FormalLayout.toDMS(190, false),
    lng200: FormalLayout.toDMS(200, false),
    lngNeg190: FormalLayout.toDMS(-190, false),
    lng180: FormalLayout.toDMS(180, false),
    lngNeg180: FormalLayout.toDMS(-180, false),
    lat95: FormalLayout.toDMS(95, true),
    latNeg95: FormalLayout.toDMS(-95, true),
    normal: FormalLayout.toDMS(107.25, false),
    normalSelatan: FormalLayout.toDMS(-6.9, true)
  }));

  // Bujur tidak pernah melebihi 180°
  expect(r.lng190).toBe('170\u00B00\'0"W');
  expect(r.lng200).toBe('160\u00B00\'0"W');
  expect(r.lngNeg190).toBe('170\u00B00\'0"E');
  expect(r.lng180).toBe('180\u00B00\'0"E');
  expect(r.lngNeg180).toBe('180\u00B00\'0"E');
  // Lintang dijepit ke kutub
  expect(r.lat95).toBe('90\u00B00\'0"N');
  expect(r.latNeg95).toBe('90\u00B00\'0"S');
  // Nilai wajar tidak berubah
  expect(r.normal).toBe('107\u00B015\'0"E');
  expect(r.normalSelatan).toBe('6\u00B054\'0"S');

  // clampLabel menjaga label tetap di dalam lebar kanvas, dengan padding
  // agar teks tidak menempel tepi (mencegah terpotong saat ekspor PNG).
  const c = await page.evaluate(() => {
    const rentang = (pusat, tw, align) => {
      const kiri = align === 'center' ? pusat - tw / 2
        : align === 'right' ? pusat - tw : pusat;
      return { kiri, kanan: kiri + tw };
    };
    const cases = [
      rentang(FormalLayout.clampLabel(-10, 40, 'center', 800), 40, 'center'),
      rentang(FormalLayout.clampLabel(810, 40, 'center', 800), 40, 'center'),
      rentang(FormalLayout.clampLabel(3, 40, 'left', 800), 40, 'left'),
      rentang(FormalLayout.clampLabel(798, 40, 'right', 800), 40, 'right'),
      rentang(FormalLayout.clampLabel(400, 40, 'center', 800), 40, 'center')
    ];
    return cases;
  });
  c.forEach(r => {
    expect(r.kiri).toBeGreaterThanOrEqual(0);
    expect(r.kanan).toBeLessThanOrEqual(800);
  });
  // Nilai yang masih di tengah tidak digeser
  expect(c[4].kiri).toBeCloseTo(380, 5);
});

test('ekspor PNG: border lembar & label berada di dalam gambar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1800);
  await page.locator('#layout-title').fill('PETA DELINASI');
  await page.waitForTimeout(800);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.locator('#btn-export-png').click()
  ]);
  expect(download.suggestedFilename()).toBe('peta-kop-akademik.png');

  const buf = await require('fs').promises.readFile(await download.path());
  expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  // Analisis tepi: border lembar harus berada DI DALAM gambar, tidak menempel
  const edge = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const W = img.width, H = img.height;
    const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3);
    const cariGelap = (axis, arah) => {
      for (let i = 0; i < 80; i++) {
        const p = axis === 'x'
          ? px(arah === '+' ? i : W - 1 - i, Math.round(H / 2))
          : px(Math.round(W / 2), arah === '+' ? i : H - 1 - i);
        if (p[0] < 120 && p[1] < 120 && p[2] < 120) return i;
      }
      return -1;
    };
    return {
      W, H,
      kiri: cariGelap('x', '+'), kanan: cariGelap('x', '-'),
      atas: cariGelap('y', '+'), bawah: cariGelap('y', '-')
    };
  }, buf.toString('base64'));

  // PNG dinaikkan 2x untuk preset formal
  expect(edge.W).toBeGreaterThan(800);
  // Keempat sisi border berada di dalam gambar (jarak > 0 dari tepi)
  expect(edge.kiri).toBeGreaterThan(0);
  expect(edge.kanan).toBeGreaterThan(0);
  expect(edge.atas).toBeGreaterThan(0);
  expect(edge.bawah).toBeGreaterThan(0);
});

/* ============================================================
   Cetak / PDF tidak boleh mengubah tata letak
   ============================================================ */

test('cetak: proporsi & urutan blok sama seperti di layar', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1800);

  const ukur = () => page.evaluate(() => {
    const sb = document.querySelector('.formal-sheet').getBoundingClientRect();
    const mb = document.querySelector('.fl-map-col').getBoundingClientRect();
    return {
      petaPersen: +(mb.width / sb.width * 100).toFixed(1),
      blok: Array.from(document.querySelectorAll('.fl-panel > .fl-block'))
        .map(x => Math.round(x.getBoundingClientRect().height)),
      legenda: document.querySelectorAll('#fl-legend .fl-legend-item').length,
      sheetTinggiAda: sb.height > 100
    };
  });

  const layar = await ukur();
  expect(layar.petaPersen).toBeGreaterThan(70);
  expect(layar.legenda).toBe(3);

  // Ukuran kertas berbeda: proporsi & jumlah blok harus tetap
  await page.emulateMedia({ media: 'print' });
  for (const [w, h] of [[794, 1123], [1123, 794], [816, 1056]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const r = await ukur();

    // Proporsi peta tidak boleh berubah jauh (toleransi 3%)
    expect(Math.abs(r.petaPersen - layar.petaPersen)).toBeLessThan(3);
    // Struktur tetap: jumlah blok & legenda sama
    expect(r.blok.length).toBe(layar.blok.length);
    expect(r.legenda).toBe(layar.legenda);
    expect(r.sheetTinggiAda).toBe(true);
  }

  // Tidak ada overflow horizontal halaman
  const of = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    vw: window.innerWidth
  }));
  expect(of.doc).toBeLessThanOrEqual(of.vw + 1);
  await page.emulateMedia({ media: 'screen' });
});

test('cetak: hasil PDF satu halaman & elemen penting tetap ada', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1800);
  await page.locator('#layout-title').fill('PETA DELINASI');
  await page.locator('#kop-mapmakerName').fill('Nama Mahasiswa');
  await page.waitForTimeout(900);

  // Elemen penting harus tetap tampil dalam mode cetak
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(700);

  const vis = await page.evaluate(() => {
    const tampil = s => {
      const e = document.querySelector(s);
      if (!e) return false;
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    return {
      sheet: tampil('.formal-sheet'),
      peta: tampil('#map'),
      panel: tampil('.fl-panel'),
      inset: tampil('.fl-inset-wrap'),
      legenda: tampil('#fl-legend'),
      tandaTangan: tampil('.fl-sign'),
      // Chrome aplikasi harus tersembunyi
      sidebar: getComputedStyle(document.querySelector('#sidebar')).display,
      topbar: getComputedStyle(document.querySelector('#topbar')).display
    };
  });
  expect(vis.sheet).toBe(true);
  expect(vis.peta).toBe(true);
  expect(vis.panel).toBe(true);
  expect(vis.inset).toBe(true);
  expect(vis.legenda).toBe(true);
  expect(vis.tandaTangan).toBe(true);
  expect(vis.sidebar).toBe('none');
  expect(vis.topbar).toBe('none');

  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(500);

  // PDF sungguhan (hanya di Chromium headless)
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(1000);
  expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBe(1);
});

/* ============================================================
   Label nama fitur, round-trip proyek, dan ekspor CSV
   ============================================================ */

test('label: nama fitur tampil di peta & bisa dimatikan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const mk = (lls, n, c) => { const l = L.polygon(lls);
      addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: n, category: c, desc: '', measure: null }, false); };
    mk([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]], 'Kawasan Industri', 'batas_admin');
    mk([[-6.95,107.60],[-6.95,107.64],[-6.99,107.64],[-6.99,107.60]], 'Sawah Irigasi', 'wilayah_studi');
  });
  await page.waitForTimeout(900);

  // Label permanen muncul di peta (bukan hanya di popup)
  const labels = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#map .dm-feature-label')).map(e => e.textContent));
  expect(await labels()).toContain('Kawasan Industri');
  expect(await labels()).toContain('Sawah Irigasi');

  const setToggle = (on) => page.evaluate((v) => {
    const el = document.querySelector('#layout-show-labels');
    el.checked = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, on);

  await setToggle(false);
  await page.waitForTimeout(700);
  expect(await labels()).toEqual([]);

  await setToggle(true);
  await page.waitForTimeout(700);
  expect((await labels()).length).toBe(2);

  // Ganti nama -> label ikut berubah
  await page.evaluate(() => { features[0].name = 'Nama Baru'; refreshFeature(features[0]); });
  await page.waitForTimeout(600);
  expect(await labels()).toContain('Nama Baru');

  // Fitur tanpa nama tidak diberi label kosong
  await page.evaluate(() => {
    const l = L.polygon([[-6.80,107.58],[-6.80,107.62],[-6.83,107.62],[-6.83,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: '', category: 'lainnya', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(700);
  expect((await labels()).length).toBe(2);
});

test('proyek: ekspor lalu impor memulihkan kop, preset & warna', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);
  await page.locator('#layout-title').fill('PETA PENTING');
  await page.locator('#kop-programStudy').fill('Perencanaan Wilayah dan Kota');
  await page.locator('#kop-supervisorTitle').fill('Dosen Pembina');
  await page.waitForTimeout(900);

  // Warna kategori kustom
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-swatch').click();
  await page.waitForTimeout(400);
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-hex').fill('#ff00aa');
  await page.locator('.cat-row[data-cat="batas_admin"] .cat-hex').blur();
  await page.waitForTimeout(700);

  // Tangkap isi GeoJSON yang diekspor
  const gj = await page.evaluate(async () => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { captured = blob; return orig.call(URL, blob); };
    exportGeoJSON();
    URL.createObjectURL = orig;
    return captured ? await captured.text() : null;
  });
  const parsed = JSON.parse(gj);
  expect(parsed.project).toBeDefined();
  expect(parsed.project.tpl).toBe('formal');
  expect(parsed.project.layout.kop.programStudy).toBe('Perencanaan Wilayah dan Kota');
  expect(parsed.project.categories.find(c => c.id === 'batas_admin').color).toBe('#ff00aa');
  expect(parsed.project.basemap).toBeDefined();
  expect(parsed.project.view).toBeDefined();

  // Reset lalu impor kembali
  await page.evaluate(() => {
    layout.title = ''; layout.kop.programStudy = ''; layout.kop.supervisorTitle = '';
    CATEGORIES = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));
    applyTemplate('klasik');
  });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => layout.title)).toBe('');
  expect(await page.evaluate(() => catOf('batas_admin').color)).toBe('#e63946');

  await page.evaluate((t) => importGeoJSON(t), gj);
  await page.waitForTimeout(1800);

  const pulih = await page.evaluate(() => ({
    judul: layout.title,
    tpl: layout.tpl,
    prodi: layout.kop.programStudy,
    pembimbing: layout.kop.supervisorTitle,
    warna: catOf('batas_admin').color,
    lembar: !!document.querySelector('.formal-sheet'),
    kontrolJudul: document.querySelector('#layout-title').value
  }));
  expect(pulih.judul).toBe('PETA PENTING');
  expect(pulih.tpl).toBe('formal');
  expect(pulih.prodi).toBe('Perencanaan Wilayah dan Kota');
  expect(pulih.pembimbing).toBe('Dosen Pembina');
  expect(pulih.warna).toBe('#ff00aa');
  expect(pulih.lembar).toBe(true);
  expect(pulih.kontrolJudul).toBe('PETA PENTING');
});

test('impor: properti dari QGIS/ArcGIS ikut terbaca', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { NAMA: 'Desa Sukamaju', KETERANGAN: 'Batas desa', LUAS: 123.4 },
        geometry: { type: 'Polygon', coordinates: [[[107.5,-6.9],[107.6,-6.9],[107.6,-6.95],[107.5,-6.9]]] } },
      { type: 'Feature', properties: { NAME: 'Kawasan Hutan', desc: 'Area lindung' },
        geometry: { type: 'Polygon', coordinates: [[[107.7,-6.9],[107.8,-6.9],[107.8,-6.95],[107.7,-6.9]]] } }
    ]
  });
  await page.evaluate((t) => importGeoJSON(t), gj);
  await page.waitForTimeout(1400);

  const fitur = await page.evaluate(() => features.map(f => ({ name: f.name, desc: f.desc })));
  expect(fitur.length).toBe(2);
  expect(fitur[0].name).toBe('Desa Sukamaju');       // dari NAMA
  expect(fitur[0].desc).toBe('Batas desa');          // dari KETERANGAN
  expect(fitur[1].name).toBe('Kawasan Hutan');       // dari NAME
  expect(fitur[1].desc).toBe('Area lindung');        // dari desc
});

test('CSV: tabel atribut untuk lampiran laporan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Keterangan sengaja memuat ';' dan kutip agar pengujian escaping nyata
  await page.evaluate(() => {
    const l = L.polygon([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: 'Sawah "Irigasi"',
                 category: 'wilayah_studi', desc: 'Luas sawah; produktif', measure: null }, false);
    const pt = L.marker([-6.88, 107.70]);
    addFeature({ id: ++idSeq, layer: pt, type: 'Marker', name: 'Titik Pantau',
                 category: 'lainnya', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(900);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#btn-export-csv').click()
  ]);
  expect(download.suggestedFilename()).toBe('tabel-delinasi.csv');

  const isi = await require('fs').promises.readFile(await download.path(), 'utf-8');

  // BOM agar Excel membaca UTF-8 dengan benar
  expect(isi.charCodeAt(0)).toBe(0xFEFF);

  const lines = isi.replace(/^\uFEFF/, '').split(/\r?\n/);
  expect(lines.length).toBe(3);                       // header + 2 fitur
  expect(lines[0].split(';')).toHaveLength(12);       // 12 kolom

  // Escaping benar: kutip digandakan, sel berisi ';' dibungkus kutip
  expect(isi).toContain('"Sawah ""Irigasi"""');
  expect(isi).toContain('"Luas sawah; produktif"');

  // Desimal memakai koma (gaya Indonesia) & ada kolom koordinat
  expect(lines[1]).toMatch(/\d+,\d+/);
  expect(lines[1]).toContain('-6,920000');
});

/* ============================================================
   Undo / Redo & cadangan otomatis
   ============================================================ */

test('undo/redo: mengembalikan bentuk fitur secara persis', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  await page.evaluate(() => {
    const l = L.polygon([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: 'Kawasan',
                 category: 'batas_admin', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(900);
  const luasAwal = await page.evaluate(() => Math.round(features[0].measure.area));

  // Geser bentuk seperti saat user menarik sudut
  await page.evaluate(() => {
    const f = features[0];
    f.layer.setLatLngs([[-6.85,107.50],[-6.85,107.70],[-6.99,107.70],[-6.99,107.50]]);
    refreshFeature(f); renderList(); save('Ubah bentuk');
  });
  await page.waitForTimeout(1000);
  const luasGeser = await page.evaluate(() => Math.round(features[0].measure.area));
  expect(luasGeser).not.toBe(luasAwal);

  // Undo -> luas & bentuk kembali persis
  await page.locator('#btn-undo').click();
  await page.waitForTimeout(1100);
  const luasUndo = await page.evaluate(() => Math.round(features[0].measure.area));
  expect(luasUndo).toBe(luasAwal);

  // Redo -> kembali ke bentuk yang digeser
  await page.locator('#btn-redo').click();
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => Math.round(features[0].measure.area))).toBe(luasGeser);
});

test('undo/redo: tombol aktif-nonaktif & shortcut keyboard', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  // Awalnya keduanya nonaktif
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await expect(page.locator('#btn-redo')).toBeDisabled();

  await seedThreeCategories(page);
  await page.waitForTimeout(900);
  await expect(page.locator('#btn-undo')).toBeEnabled();
  await expect(page.locator('#btn-redo')).toBeDisabled();

  // Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  await expect(page.locator('#feat-count')).toHaveText('2');
  await expect(page.locator('#btn-redo')).toBeEnabled();

  // Ctrl+Shift+Z
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(900);
  await expect(page.locator('#feat-count')).toHaveText('3');

  // Ctrl+Y juga berfungsi untuk redo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  await expect(page.locator('#feat-count')).toHaveText('2');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(900);
  await expect(page.locator('#feat-count')).toHaveText('3');

  // Undo sampai habis -> tombol undo nonaktif lagi
  while (await page.evaluate(() => History.canUndo())) {
    await page.locator('#btn-undo').click();
    await page.waitForTimeout(450);
  }
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await expect(page.locator('#feat-count')).toHaveText('0');
});

test('undo: berlaku untuk hapus, warna kategori, dan teks kop', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  await seedThreeCategories(page);
  await page.waitForTimeout(900);

  // 1. Hapus fitur -> undo
  await page.evaluate(() => deleteFeature(features[0].id));
  await page.waitForTimeout(900);
  await expect(page.locator('#feat-count')).toHaveText('2');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1000);
  await expect(page.locator('#feat-count')).toHaveText('3');

  // 2. Ubah warna kategori -> undo
  await page.evaluate(() => {
    setCategoryColor('batas_admin', '#00ff00');
    features.forEach(f => applyStyle(f));
    renderList();
    save('Ubah warna');
  });
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => catOf('batas_admin').color)).toBe('#00ff00');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => catOf('batas_admin').color)).toBe('#e63946');

  // 3. Ubah teks kop di lembar formal -> undo (input ikut tersinkron)
  await page.locator('[data-tpl="formal"]').click();
  await page.waitForTimeout(1400);
  await page.locator('#kop-programStudy').fill('Perencanaan Wilayah dan Kota');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => layout.kop.programStudy)).toBe('Perencanaan Wilayah dan Kota');

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => layout.kop.programStudy)).toBe('');
  await expect(page.locator('#kop-programStudy')).toHaveValue('');
  // Lembar formal tidak boleh lepas akibat undo
  await expect(page.locator('.formal-sheet')).toHaveCount(1);
});

test('cadangan: salinan otomatis tersimpan & bisa dibaca', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  await seedThreeCategories(page);
  await page.waitForTimeout(900);

  // Cadangan dijadwalkan dengan penundaan; tunggu sampai tertulis
  await expect
    .poll(async () => page.evaluate(() => {
      const c = Backup.read();
      if (!c) return 0;
      try { return JSON.parse(c.raw).features.length; } catch (e) { return -1; }
    }), { timeout: 8000, message: 'cadangan tidak terbentuk' })
    .toBe(3);

  // Cadangan berisi state lengkap, bukan hanya fitur
  const isi = await page.evaluate(() => {
    const d = JSON.parse(Backup.read().raw);
    return { layout: !!d.layout, categories: Array.isArray(d.categories),
             kop: !!(d.layout && d.layout.kop) };
  });
  expect(isi.layout).toBe(true);
  expect(isi.categories).toBe(true);
  expect(isi.kop).toBe(true);
});

test('undo: berlaku berurutan & tetap jalan saat fokus di kolom teks', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  await page.evaluate(() => {
    const l = L.polygon([[-6.90,107.58],[-6.90,107.62],[-6.94,107.62],[-6.94,107.58]]);
    addFeature({ id: ++idSeq, layer: l, type: 'Polygon', name: 'A',
                 category: 'batas_admin', desc: '', measure: null }, false);
  });
  await page.waitForTimeout(900);

  // Ketik judul (menambah satu langkah riwayat)
  await page.locator('#layout-title').click();
  await page.locator('#layout-title').fill('Judul Baru');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => layout.title)).toBe('Judul Baru');

  // Ctrl+Z #1 -> mengurungkan perubahan judul (perubahan terakhir)
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => layout.title)).toBe('');
  expect(await page.evaluate(() => features.length)).toBe(1);

  // Ctrl+Z #2 -> baru mengurungkan penambahan fitur
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => features.length)).toBe(0);

  // Redo mengembalikan keduanya secara berurutan
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => features.length)).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => layout.title)).toBe('Judul Baru');
});

test('shortcut: tombol huruf tidak mengganggu saat mengetik di kolom teks', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1400);

  // Mengetik "peta" di kolom judul tidak boleh mengaktifkan alat gambar
  await page.locator('#layout-title').click();
  await page.locator('#layout-title').type('peta', { delay: 60 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() =>
    document.querySelector('.tool[data-tool="Polygon"]').classList.contains('active'))).toBe(false);
  await expect(page.locator('#layout-title')).toHaveValue('peta');

  // Di luar kolom teks, shortcut tetap berfungsi
  await page.locator('#map').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() =>
    document.querySelector('.tool[data-tool="Polygon"]').classList.contains('active'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

/* ============================================================
   Kualitas tampilan: token desain, meta, favicon
   ============================================================ */

test('desain: favicon & meta sosial terpasang', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });

  const meta = await page.evaluate(() => ({
    icon: !!document.querySelector('link[rel="icon"]'),
    apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || '',
    ogDesc: (document.querySelector('meta[property="og:description"]') || {}).content || '',
    ogType: (document.querySelector('meta[property="og:type"]') || {}).content || '',
    theme: (document.querySelector('meta[name="theme-color"]') || {}).content || '',
    desc: (document.querySelector('meta[name="description"]') || {}).content || '',
    title: document.title
  }));

  expect(meta.icon).toBe(true);
  expect(meta.apple).toBe(true);
  expect(meta.ogTitle).toContain('Delinaisi Maker');
  expect(meta.ogDesc.length).toBeGreaterThan(40);
  expect(meta.ogType).toBe('website');
  expect(meta.theme).toMatch(/^#[0-9a-f]{6}$/i);
  expect(meta.desc).toContain('delinasi');
  expect(meta.title).toContain('Delinaisi Maker');

  // Favicon berupa SVG data URI (tanpa berkas tambahan)
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toContain('data:image/svg+xml');
});

test('desain: token z-index & radius dipakai konsisten', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Token terdefinisi
  const token = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const ambil = k => cs.getPropertyValue(k).trim();
    return {
      rXs: ambil('--r-xs'), rSm: ambil('--r-sm'), rMd: ambil('--r-md'),
      rLg: ambil('--r-lg'), rPill: ambil('--r-pill'),
      zHeader: ambil('--z-header'), zModal: ambil('--z-modal'),
      zToast: ambil('--z-toast'), zDrawer: ambil('--z-drawer')
    };
  });
  Object.values(token).forEach(v => expect(v).not.toBe(''));

  // Urutan lapisan masuk akal: drawer < header < modal < toast
  const num = v => parseInt(v, 10);
  expect(num(token.zDrawer)).toBeLessThan(num(token.zHeader));
  expect(num(token.zHeader)).toBeLessThan(num(token.zModal));
  expect(num(token.zModal)).toBeLessThan(num(token.zToast));

  // Radius komponen konsisten (tombol/alat/input memakai skala yang sama)
  const r = await page.evaluate(() => {
    const g = s => getComputedStyle(document.querySelector(s)).borderRadius;
    return { btn: g('.btn'), tool: g('.tool'), input: g('.field input'), card: g('.card') };
  });
  expect(r.btn).toBe(r.tool);
  expect(r.btn).toBe(r.input);
  // Wadah (kartu) lebih membulat daripada komponen di dalamnya
  expect(parseInt(r.card, 10)).toBeGreaterThan(parseInt(r.btn, 10));
});

test('desain: layout memakai dvh agar tidak melompat di mobile', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(600);

  // Baca berkas dari disk (fetch diblokir pada protokol file://),
  // lalu pastikan dvh dipakai DENGAN fallback vh untuk browser lama.
  const cssTeks = require('fs').readFileSync(
    path.join(__dirname, '..', 'css', 'style.css'), 'utf-8');
  expect(cssTeks).toMatch(/100dvh/);
  expect(cssTeks).toMatch(/height:\s*calc\(100vh/);   // fallback

  // Pada browser yang mendukung, tinggi #app benar-benar terhitung
  expect(await page.evaluate(() => CSS.supports('height', '100dvh'))).toBe(true);
  const tinggi = await page.evaluate(() =>
    parseInt(getComputedStyle(document.querySelector('#app')).height, 10));
  expect(tinggi).toBeGreaterThan(100);
});

test('desain: focus ring tetap terlihat di atas header biru', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(600);

  // Outline putih untuk kontrol di header (biru), karena outline biru
  // di atas latar biru hampir tidak terlihat.
  const warna = await page.evaluate(() => {
    const hasil = {};
    ['#btn-undo', '#btn-redo'].forEach(sel => {
      const el = document.querySelector(sel);
      el.focus();
      hasil[sel] = getComputedStyle(el).outlineColor;
    });
    return hasil;
  });
  Object.values(warna).forEach(c => expect(c).toBe('rgb(255, 255, 255)'));
});

test('desain: placeholder & pesan memakai contoh nyata, bukan generik', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(600);

  const ph = await page.evaluate(() => Array.from(document.querySelectorAll('[placeholder]'))
    .map(e => e.getAttribute('placeholder')));

  // Tidak ada placeholder bergaya template
  const terlarang = /lorem|john doe|jane smith|acme|nexus|company name|foo|bar/i;
  ph.forEach(t => expect(t).not.toMatch(terlarang));

  // Contoh spesifik & realistis
  expect(ph.join(' | ')).toContain('Hasanuddin');
  expect(ph.join(' | ')).toContain('Rahmat Hidayat');
});

/* ============================================================
   Halaman 404 & skeleton pemuatan
   ============================================================ */

test('404: halaman sendiri dengan jalan kembali, bukan halaman GitHub polos', async ({ page }) => {
  const fs = require('fs');
  const path404 = path.join(__dirname, '..', '404.html');
  expect(fs.existsSync(path404)).toBe(true);

  const html = fs.readFileSync(path404, 'utf-8');

  // Tanpa dependensi luar supaya tetap tampil walau css/js gagal dimuat
  expect(html).not.toMatch(/<link[^>]+href="css\//);
  expect(html).not.toMatch(/<script[^>]+src="js\//);
  // Bahasa Indonesia & judul yang jelas
  expect(html).toMatch(/lang="id"/);
  expect(html).toMatch(/tidak ditemukan/i);
  // Harus ada jalan kembali (bukan jalan buntu)
  expect(html).toMatch(/Kembali ke peta/);
  expect(html).toMatch(/href="\.\/"/);
  // Tidak diindeks mesin pencari
  expect(html).toMatch(/name="robots"[^>]*noindex/);

  // Favicon + warna tema konsisten dengan aplikasi utama
  expect(html).toMatch(/rel="icon"/);
  expect(html).toMatch(/theme-color/);

  // Tampil benar di browser
  await page.goto(require('url').pathToFileURL(path404).href);
  await expect(page.locator('h2')).toContainText('tidak ada');
  await expect(page.locator('a.btn-utama')).toBeVisible();
  await expect(page.locator('.kode')).toHaveText(/404/);
});

test('skeleton: muncul saat mencari batas lalu digantikan hasil', async ({ page }) => {
  // Tunda respons agar skeleton sempat terlihat
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    await new Promise(r => setTimeout(r, 1200));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'Bogor, Jawa Barat', name: 'Bogor',
        category: 'boundary', type: 'administrative', place_rank: 12,
        osm_type: 'relation', osm_id: 1,
        geojson: { type: 'Polygon',
          coordinates: [Array.from({ length: 60 }, (_, i) => [106.7 + i * 0.001, -6.5])] } }]) });
  });

  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('#admin-q').fill('Bogor');
  await page.locator('#admin-search').click();
  await page.waitForTimeout(400);

  // Skeleton berbentuk kartu hasil, bukan spinner
  expect(await page.locator('.sk-admin').count()).toBeGreaterThan(0);

  // Setelah hasil tiba, skeleton hilang & hasil asli tampil
  // (fixture berisi 1 batas sah; entri "kantor" tersaring oleh filter)
  await expect(page.locator('.admin-item')).toHaveCount(1, { timeout: 8000 });
  expect(await page.locator('.sk-admin').count()).toBe(0);
});

test('skeleton: daftar fitur tidak tertimpa saat memuat data tersimpan', async ({ page }) => {
  await page.goto(APP);
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await seedThreeCategories(page);
  await page.waitForTimeout(900);
  const stored = await page.evaluate(() => localStorage.getItem('delinaisi-maker-v1'));
  expect(JSON.parse(stored).features).toHaveLength(3);

  await page.addInitScript((d) => localStorage.setItem('delinaisi-maker-v1', d), stored);
  await page.reload();
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Daftar fitur harus terisi — dulu skeleton menimpanya sehingga kosong
  await expect(page.locator('#feat-count')).toHaveText('3');
  await expect(page.locator('.feat')).toHaveCount(3);
  // Skeleton tidak boleh menggantung
  expect(await page.locator('.sk-item').count()).toBe(0);
});

test('skeleton: hormati prefers-reduced-motion', async ({ page }) => {
  const css = require('fs').readFileSync(
    path.join(__dirname, '..', 'css', 'style.css'), 'utf-8');
  // Animasi gelombang dimatikan bagi pengguna yang memintanya
  expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,220}\.sk-blok\s*\{\s*animation:\s*none/);
});
