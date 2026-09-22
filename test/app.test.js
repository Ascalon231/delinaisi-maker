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
