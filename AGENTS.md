# AGENTS.md — Delinaisi Maker

Panduan kerja untuk agen AI (dan manusia) yang menyentuh repositori ini.
Bacanya lebih dulu sebelum mengubah apa pun.

- **Situs live:** https://ascalon231.github.io/delinaisi-maker/
- **Repositori:** https://github.com/Ascalon231/delinaisi-maker
- **Sifat proyek saat ini:** aplikasi web statis, gratis, tanpa login
- **Arah pengembangan:** menjadi produk SaaS untuk pembuatan peta delinasi
  oleh siapa pun (lihat bagian [Menuju SaaS](#menuju-saas))

---

## 1. Apa produk ini

Delinaisi Maker adalah alat pembuat **peta delinasi** — peta yang membatasi
atau memilah wilayah (batas administrasi, zona peruntukan, wilayah studi,
kawasan rawan, dsb). Pengguna menggambar poligon/garis/titik di atas peta,
luas dan keliling dihitung otomatis, lalu hasilnya diekspor menjadi peta siap
lapor.

Pengguna utama yang sudah terbukti: **mahasiswa** (tugas studio perencanaan
wilayah, skripsi, praktikum GIS) dan **staf instansi** yang perlu membuat peta
batas cepat tanpa memasang QGIS/ArcGIS.

Yang membedakan dari alat sejenis: **hasil akhirnya lembar peta formal
berkop** (judul, legenda, skala batang, diagram lokasi, blok pengesahan) yang
bisa langsung dicetak — bukan sekadar tangkapan layar peta.

---

## 2. Kondisi teknis saat ini (fakta, bukan rencana)

| Aspek | Keadaan |
|---|---|
| Arsitektur | **File statis** — HTML + CSS + JS biasa, tanpa build step |
| Bahasa | JavaScript vanilla (ES6+), tanpa framework |
| Peta | Leaflet 1.9.4 + Leaflet.draw 1.0.4 (dari CDN) |
| Hitung geospasial | Turf.js 6.5.0 (dari CDN) |
| Ekspor PNG | html2canvas 1.4.1 (dari CDN) |
| Penyimpanan | `localStorage` browser, **tanpa server** |
| Backend | **Tidak ada** |
| Akun / autentikasi | **Tidak ada** |
| Basis data | **Tidak ada** |
| Testing | Playwright, **100 test** (`npm test`) |
| Deploy | GitHub Pages, branch `main`, folder `/` |

Artinya: seluruh logika berjalan di browser pengguna, dan data peta tersimpan
per-browser. Ini keputusan sadar yang membuat aplikasi gratis, privat, dan
instan — tapi juga **batas utama** menuju SaaS (lihat bagian 6).

---

## 3. Susunan berkas

```
index.html            Struktur halaman + panel sisi kiri
404.html              Halaman alamat salah (dipakai otomatis oleh GitHub Pages)
css/
  style.css           Tampilan editor + token desain (warna, radius, z-index, tipografi)
  formal-sheet.css    Tampilan lembar peta "Kop Akademik"
  print-layout.css    Kerangka aturan cetak: #map-wrap, @page, tinggi area cetak
js/
  app.js              Logika utama: gambar, ukur, daftar fitur, impor/ekspor, penyimpanan
  formal-sheet.js     Lembar 2 kolom: kop, inset, legenda otomatis, tampil/sembunyi bagian
  formal-layout.js    Graticule (grid koordinat), skala batang, format DMS
  admin-boundaries.js Batas administrasi dari Nominatim (lapisan terpisah)
  history.js          Riwayat undo/redo + cadangan otomatis
  print-layout.js     Jembatan ekspor PNG & cetak/PDF (PaperLayout)
test/app.test.js      Semua test (Playwright)
```

### Tanggung jawab tiap modul (jangan dicampur)

- **`app.js`** — pemilik tunggal state `features`, `layout`, `CATEGORIES`.
  Modul lain membaca state ini, tidak menyimpan salinannya.
- **`formal-sheet.js`** — membangun DOM lembar. Semua teks berasal dari
  `layout.kop`. Tidak menghitung apa pun sendiri.
- **`formal-layout.js`** — murni fungsi gambar & format (canvas/SVG). Tidak
  menyentuh DOM halaman dan tidak menyimpan state.
- **`admin-boundaries.js`** — satu-satunya modul yang memanggil Nominatim.
  Wajib mematuhi kebijakan layanan (bagian 5).
- **`history.js`** — snapshot state + cadangan. Tidak tahu isi state.
- **`print-layout.js`** — satu-satunya tempat `html2canvas` dan `window.print()` dipanggil.

---

## 4. Aturan yang tidak boleh dilanggar

### 4.1 Jangan tambahkan penyedia peta yang butuh API key

Semua peta dasar harus **gratis tanpa kunci** supaya aplikasi tetap bisa
dipakai siapa saja tanpa pendaftaran. Penyedia berikut **dilarang** karena
butuh token: Stadia Maps, Mapbox, Thunderforest, MapTiler, TomTom, HERE.

Sudah diverifikasi: `https://tiles.stadiamaps.com/...` mengembalikan **401**
tanpa kunci. Ada test yang gagal otomatis bila URL peta dasar mengandung pola
`api_key` / `token` / `{key}` atau nama penyedia di atas.

Peta dasar yang dipakai sekarang: OpenStreetMap, Esri (citra & topo),
OpenTopoMap, plus mode "Kosong".

### 4.2 Patuhi kebijakan Nominatim

`admin-boundaries.js` memakai Nominatim publik. Kebijakan resmi:
https://operations.osmfoundation.org/policies/nominatim/

Yang **wajib** dipatuhi:

- **Dilarang autocomplete.** Pencarian batas hanya dijalankan saat tombol
  atau Enter ditekan, **bukan** saat pengguna mengetik. Ada test yang
  memastikan 0 permintaan saat mengetik.
- **Maksimum 1 permintaan/detik.** Semua permintaan lewat antrean berjeda
  1,1 detik.
- **Hasil wajib di-cache.** Disimpan di `localStorage` (TTL 14 hari).
- **Atribusi OSM ditampilkan** di UI dan ikut ke legenda lembar cetak.

Catatan: pencarian lokasi biasa (`doSearch` di `app.js`) masih memicu saat
mengetik dengan jeda 380 ms. Ini **berisiko** menurut kebijakan. Belum
diubah agar tidak mengubah perilaku tanpa persetujuan. Kandidat perbaikan.

### 4.3 Cetak tidak boleh mengubah tata letak

Yang berbahaya bukan keberadaan `@media print`, melainkan **dua berkas
mengatur elemen tata letak yang sama saat cetak**. Dulu ada tiga blok yang
saling bertabrakan dan memakai `100vh`, sehingga lembar melebar keluar
halaman.

Aturan yang berlaku sekarang (diverifikasi 29 Sep):

| Berkas | Boleh mengatur saat cetak |
|---|---|
| `css/print-layout.css` | Kerangka halaman: `#map-wrap`, `@page`, sembunyikan chrome, tinggi area cetak |
| `css/formal-sheet.css` | Isi lembar: `grid-template-columns`, warna ikut cetak, `break-inside` |
| `css/style.css` | **Hanya** detail kecil non-tata-letak (mis. gaya label fitur) |

- Elemen tata letak (`#map-wrap`, `.formal-sheet`, `.fl-panel`) **hanya boleh**
  diatur oleh satu berkas. Kalau perlu menambah aturan cetak di berkas lain,
  pastikan tidak menyentuh dua elemen di atas.
- Satuan memakai `mm` atau persen halaman, **jangan `vh`** — `vh` mengacu ke
  viewport layar, bukan halaman.
- Proporsi kolom wajib dipertahankan (`grid-template-columns` dengan `min()`),
  kalau tidak peta menyusut dari 71% ke 61% di A4 tegak.
- **Uji di 4 ukuran kertas** (A4 tegak, A4 mendatar, Letter, A3): proporsi
  peta tidak boleh berbeda >3% dari layar dan tidak boleh meluber.

### 4.4 Preset layout

Saat ini aplikasi memakai **satu preset**: lembar "Kop Akademik".
Empat preset lama (Klasik, Rapat Kanan, Judul Bawah, Bersih) beserta elemen
overlay-nya (`#map-title`, `#map-legend`, `#map-north`, `#map-credit`)
**sudah dihapus** atas keputusan pemilik produk.

Versi lama masih ada di git: `git show afc4fb1:index.html`.
Jangan menghidupkan kembali kode preset lama tanpa diminta.

### 4.5 Jangan menyentuh berkas proyek dengan skrip massal

Pelajaran mahal: penggantian teks massal (Python/regex) pernah **memotong
38 baris** `index.html` dan **23 baris** `css/formal-sheet.css` tanpa
peringatan, karena pola yang dicari ternyata lebih luas dari yang dimaksud.

Aturan:
- Setelah setiap penggantian massal, **verifikasi jumlah baris** dan cek
  elemen penting masih ada.
- Untuk perubahan kecil, pakai edit bertarget — bukan tulis-ulang berkas.
- Selalu `git diff --stat` sebelum commit; lonjakan penghapusan yang tidak
  wajar adalah tanda kerusakan.

### 4.6 Batas yang harus dijaga saat menggambar

- Label graticule di tepi: pakai `clampLabel()` dengan padding. Label yang
  menempel tepi kanvas terlihat terpotong saat diekspor PNG.
- Skala batang: pakai `niceDistanceFloor()` (bulat **ke bawah**).
  `niceDistance()` membulatkan ke atas dan pernah membuat batang 473px di
  panel 300px.
- Transparansi: isian poligon 0.28, atribusi inset 0.78, kotak cakupan 0.18.
  Keterbacaan dijaga lewat **halo putih pada garis**, bukan dengan menaikkan
  opacity isian.

---

## 5. Kebiasaan kerja di repositori ini

### Menjalankan

```bash
npm start          # server lokal di http://localhost:8000
npm test           # 91 test Playwright
```

Tidak ada `npm install` yang diperlukan untuk memakai aplikasi — semua
pustaka dimuat dari CDN. `npm install` hanya untuk menjalankan test.

### Test

- **Selalu jalankan `npm test` sebelum commit.** 100 test, ±8 menit.
- Test berada di `test/app.test.js`. Tambahkan test untuk setiap perbaikan
  bug — terutama bug yang "tampak berfungsi tapi tidak".
- Pakai **fixture tiruan** untuk Nominatim, jangan panggil server publik dari
  test (sudah jadi kebiasaan di berkas test).
- Jangan melunakkan assertion demi test hijau. Kalau ekspektasi test salah,
  perbaiki ekspektasinya dan **sebutkan alasannya** di pesan commit.

### Commit & deploy

1. `npm test` hijau
2. `git add -A && git commit` dengan pesan berbahasa Indonesia yang
   menjelaskan **apa** dan **mengapa**, bukan sekadar "fix bug"
3. `git push origin main`
4. GitHub Pages membangun otomatis (legacy builder, ±1-2 menit)

Catatan: commit perantara kadang berstatus `errored` karena builder lama
sedang sibuk saat push berikutnya datang. Yang penting commit **terakhir**
berstatus `built` — verifikasi lewat:

```bash
gh api repos/Ascalon231/delinaisi-maker/pages/builds/latest --jq '.status'
```

### Standar kode

- Bahasa komentar & pesan UI: **Indonesia**.
- Nama variabel/fungsi: campuran Indonesia (`blokTampil`, `simpan`) dan
  Inggris (`buildScaleBar`) — ikuti gaya berkas yang sedang disunting.
- Setiap berkas JS diawali komentar blok `/* ==== */` yang menjelaskan
  tanggung jawabnya.
- Gunakan token desain (`--r-*`, `--z-*`, `--t-*`, `--font-*`) — jangan
  menulis nilai `z-index` atau `border-radius` mentah.
- Semua teks yang dilihat pengguna harus berbahasa Indonesia.

---

## 6. Menuju SaaS

Tujuan jangka panjang: menjadikan ini produk berlangganan untuk **siapa pun**
yang perlu membuat peta delinasi — mahasiswa, konsultan, staf dinas, LSM.

### 6.1 Hambatan utama (harus diselesaikan lebih dulu)

**Tidak ada akun.** Data hanya ada di browser. Kalau pengguna berganti
perangkat atau membersihkan browser, pekerjaannya hilang. Tidak mungkin
menagih langganan tanpa identitas pengguna.

**Tidak ada penyimpanan di server.** Kolaborasi, riwayat versi, dan
berbagi tautan mustahil tanpa backend.

**Ketergantungan pada layanan gratis pihak ketiga.** Nominatim publik
melarang penggunaan komersial berskala besar (lihat kebijakannya). Untuk
SaaS perlu Nominatim sendiri atau penyedia berbayar.

**Ekspor belum lengkap.** SHP/KMZ belum ada — padahal banyak instansi
mensyaratkannya.

### 6.2 Urutan pengerjaan yang disarankan

Tahap 1 — **Perkuat produk gratis** (tanpa backend)
- [x] Kustomisasi kop penuh: inline editable judul komponen, urutan blok (reorder), tambah/hapus blok kustom
- [x] Kompas / Arah Utara: beragam varian visual (klasik, modern, militer, bintang, segitiga) & huruf U/N
- [x] Skala kustom & preset: penyesuaian zoom peta otomatis via representative fraction (RF) dan sinkronisasi label skala
- [x] Legenda informatif: opsi menampilkan total luas & panjang per kategori secara dinamis
- [x] Batas administrasi lengkap: tingkat nasional hingga desa, filter kawasan laut vs daratan, dan salin batas langsung ke delinasi gambar
- [x] Batas resmi alternatif (Katalog Kemendagri / BPS 38 Provinsi, 514 Kab/Kota, 7.200+ Kecamatan & Desa tanpa batas kuota)
- [x] Pewarnaan & transparansi dinamis: slider kepekatan isian (fillOpacity) per fitur & per kategori, serta warna kustom fleksibel per fitur
- Input titik koordinat manual (untuk memasukkan batas dari data resmi)
- Ekspor SHP/KMZ
- Snapshot bernama ("revisi 1", "revisi 2") untuk revisi dari dosen/atasan
- Font berkarakter (ubah `--font-ui`)


Tahap 2 — **Backend minimum**
- Akun (email + kata sandi, atau OAuth)
- Simpan proyek di server, bukan hanya `localStorage`
- Berbagi tautan hanya-baca
- Tetap pertahankan mode tamu: aplikasi harus tetap berguna tanpa akun

Tahap 3 — **Fitur berbayar**
- Kuota ekspor resolusi tinggi / batch
- Template kop instansi tersimpan
- Kolaborasi tim
- Nominatim sendiri agar tidak melanggar batas layanan publik

Tahap 4 — **Kepatuhan & kepercayaan**
- Kebijakan privasi + syarat layanan (wajib begitu ada akun & pembayaran)
- Banner cookie **hanya bila** menambahkan analitik/pelacakan
- Pemrosesan pembayaran

### 6.3 Yang harus dipertahankan saat menjadi SaaS

- **Mode tamu tetap ada.** Jangan paksa daftar untuk mencoba.
- **Data pengguna tetap milik pengguna.** Selalu sediakan ekspor penuh
  (GeoJSON sudah menyimpan seluruh proyek — lihat `metadata.project`).
- **Tetap tanpa API key untuk peta dasar** selama memungkinkan, supaya biaya
  tidak melonjak dan aplikasi tetap ringan.
- **Kualitas hasil cetak tidak boleh turun.** Itu pembeda utama produk ini.

---

## 7. Jebakan yang sudah pernah ditemui

Daftar ini nyata dan sudah diperbaiki — jangan diulang.

| Gejala | Sebab |
|---|---|
| Toggle tampak aktif tapi tidak berefek | `applyInsetPrefs()` dan `clearText()` menulis ulang `style.display` setelah `applyBlokPrefs()` |
| Daftar fitur kosong saat memuat data tersimpan | Skeleton memulihkan `innerHTML` lama dan menimpa hasil `renderList()` |
| Skala melewati batas panel | `niceDistance()` membulatkan ke atas |
| Label koordinat terpotong saat jadi PNG | Label menempel tepi kanvas, tanpa padding |
| Lembar melebar keluar halaman saat dicetak | Tiga blok `@media print` bertabrakan, memakai `100vh` |
| Tombol "Gambar PNG" & "Cetak" mati | `PaperLayout` dirujuk tapi berkasnya tidak ada |
| Pencarian "Kecamatan Cibinong" tak menemukan apa pun | Di OSM relasi batas bernama polos ("Cibinong"); awalan tingkat kini dibuang otomatis |
| Menggambar poligon malah muncul "Kantor Kecamatan" | Kueri mengembalikan bangunan; disaring `category=boundary` + minimal 20 titik |
| Ketikan "peta" di kolom judul mengaktifkan alat poligon | Shortcut huruf tidak dijaga saat fokus di kolom teks |
| Lockdown editor: `#map` selebar 741px, bukan 1164px | Peta kini hanya mengisi kolom kiri lembar formal; test pakai koordinat pecahan |
| Hapus fitur tak bisa diurungkan | Undo dulu hanya lewat toast, tidak ada riwayat |
| Klik peta di test Playwright meleset | `grid-outside` menambah margin luar di `#map`; gunakan titik aman seperti `{ x: 350, y: 250 }` |
| Skala RF terbaca jadi miliaran (mis. 1100000) | String `"SKALA: 1:100.000"` jika di-regex angka langsung menggabungkan `"1"` dan `"100000"`; harus di-split setelah tanda `:` |
| Batas tiruan di test Playwright ditolak | `isRealBoundary` mewajibkan `countPoints >= 20` untuk menyaring bangunan; mock fixture harus memiliki minimal 20 titik |

---

## 8. Ringkasan perintah

```bash
npm start                                     # jalankan lokal
npm test                                      # 100 test
npm test -- -g "nama test"                    # jalankan test tertentu
gh api repos/Ascalon231/delinaisi-maker/pages/builds/latest --jq '.status'
git show afc4fb1:index.html                   # versi 5 preset (lama)
```

