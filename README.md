# Delinaisi Maker 🗺️

Web sederhana untuk **membuat peta delinasi** (pembatasan/pemilahan wilayah) yang bisa
digunakan siapa saja — terutama mahasiswa. Gambar poligon, garis, atau titik di atas
peta, otomatis dapat **luas & keliling**, isi nama dan keterangan, lalu ekspor ke
**GeoJSON** atau **PNG** untuk laporan/tugas.

Gratis, tanpa login, tanpa server — semuanya berjalan di browser.

## ✨ Fitur

- **Gambar di peta**: titik, garis, poligon, persegi, lingkaran
- **Hitung otomatis**: luas (m²/ha/km²), keliling/panjang (m/km), koordinat
- **Label & atribut**: nama, jenis deliniasi (8 kategori dengan warna berbeda), keterangan
- **Layout peta** mengikuti standar kartografi Indonesia (8 elemen wajib):
  **judul** (tengah-atas), **legenda** (kanan, auto-update), **arah utara** (kanan-atas),
  **skala** (kiri-bawah), dan **kotak kredit** (kanan-bawah) berisi nama pembuat,
  tanggal, **sumber data** (menyesuaikan peta dasar), dan **sistem koordinat**.
  Semuanya ikut saat ekspor PNG / cetak PDF.
- **5 template layout** gaya QGIS/ArcGIS tinggal pilih:
  **Klasik** (elemen menyebar), **Rapat Kanan** (semua di sisi kanan),
  **Judul Bawah** (gaya akademik modern), **Bersih** (hanya inti), dan
  **Kop Akademik** (lembar formal 2 kolom untuk laporan/studio).
- **Preset "Kop Akademik" (formal)** — tata letak kop peta kartografi standar:
  - Peta (±75%) berbingkai di kiri, panel informasi (±25%) di kanan
  - **Graticule** lintang/bujur otomatis dengan label **DMS** (mis. `107°15'0"E`)
    di keempat sisi frame; interval menyesuaikan zoom (0°10' pada skala kabupaten)
  - **Skala batang** bergaya peta cetak (kotak hitam-putih berselang) + skala
    numerik `1:xxx.xxx`, plus ikon mata angin
  - **Diagram lokasi** (inset map): peta Leaflet kedua yang zoom-out, dengan
    **kotak merah** yang mengikuti `getBounds()` peta utama secara real-time,
    plus grid koordinatnya sendiri
  - **Legenda otomatis** dari kategori unik yang dipakai fitur
  - **Pengelola warna kategori**: klik kotak warna untuk membuka palet 48 warna
    siap pakai (6 grup), input HEX manual, color picker bebas, dan eyedropper
    (bila browser mendukung). Ada pratinjau cara warna tampil di peta/legenda,
    peringatan bila dua kategori berwarna sama, serta kategori bisa
    **ditambah, diganti nama, dan dihapus** — semuanya tersimpan otomatis
  - Blok Proyeksi/Zona/Datum, Sumber Data, dan pengesahan tanda tangan
  - Semua teks berasal dari input user (generik, bisa untuk topik apa pun)
- **8 peta dasar, semuanya gratis & tanpa API key**: Peta Jalan (OpenStreetMap),
  Satelit (Esri), **Relief** (Esri Topo — bentuk lahan), **Topografi**
  (OpenTopoMap — kontur & puncak), Minimal & Voyager & Gelap (CARTO), serta
  **Kosong** (tanpa peta dasar). Sengaja tidak memakai penyedia ber-API key
  seperti Stadia/Mapbox/Thunderforest agar tidak gagal di komputer pengguna.
- **Cari lokasi** ketik nama tempat/kota/kampus (Nominatim)
- **Edit bentuk** ulang lewat alat Edit
- **Impor GeoJSON** hasil kerja sebelumnya atau dari aplikasi lain (mis. QGIS)
- **Ramah pengguna & mudah diakses**:
  - **Pintasan keyboard** — `T` titik, `G` garis, `P` poligon, `K` kotak, `B` bulat, `E` edit, `Esc` batal
  - **Urungkan (undo)** — fitur yang tak sengaja dihapus bisa dipulihkan lewat toast
  - **Indikator memuat** — bar tipis di atas peta saat tile dimuat
  - **Aksesibilitas** — aria-label di semua tombol ikon, focus trap di modal, skip link,
    dukungan `prefers-reduced-motion`
  - **Responsif penuh** — di layar kecil, panel kiri jadi drawer dengan backdrop & tombol tutup
- **Ekspor GeoJSON** (bisa dibuka di QGIS) atau **PNG** (untuk laporan)
- **Cetak / PDF** langsung dari browser
- **Otomatis tersimpan** di browser (localStorage) — aman dari refresh tak sengaja
- **Responsif** untuk laptop & HP, antarmuka lengkap dalam Bahasa Indonesia

## 🚀 Cara menjalankan

Cukup buka `index.html` di browser. Atau jalankan server lokal:

```bash
python3 -m http.server 8000
# buka http://localhost:8000
```

Tidak perlu `npm install` hanya untuk memakai aplikasi — semua pustaka dimuat dari CDN.

## 🧪 Testing otomatis

```bash
# Pasang sekali saja (browser uji disimpan di .test/)
npm install
npx playwright install chromium

# Jalankan test (29 test)
npm test
```

Test memverifikasi: peta dimuat tanpa error, gambar poligon & hitung luas, simpan atribut,
daftar fitur, penyimpanan localStorage & pemulihan, ekspor GeoJSON, marker dengan koordinat,
ganti peta dasar, tampilan & persistensi layout peta, ganti template layout, serta
preset "Kop Akademik" (lembar 2 kolom, legenda otomatis 3 kategori + warna kustom,
graticule/skala/kompas/inset, sinkronisasi bounding box, dan persistensi field kop).

> Catatan: di beberapa environment headless, `localStorage` tidak bertahan setelah `reload()`.
> Test pemulihan memakai `addInitScript` untuk menyimulasikan storage persisten.

## 📦 Deploy ke internet (gratis)

1. **GitHub Pages** (paling cocok untuk mahasiswa):
   ```bash
   git init && git add . && git commit -m "Delinaisi Maker"
   gh repo create delinaisi-maker --public --source=. --push
   # Settings → Pages → Source: branch main, folder /root
   ```
   Setelah ~1 menit, situs online di `https://username.github.io/delinaisi-maker/`.

2. **Netlify / Vercel**: tarik-lepas folder ini ke dashboard, langsung online.

## 🛠️ Teknologi

| Library | Fungsi |
|---|---|
| [Leaflet](https://leafletjs.com/) | Peta interaktif |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Alat gambar |
| [Turf.js](https://turfjs.org/) | Perhitungan geospasial (luas, keliling) |
| [html2canvas](https://html2canvas.hertzen.com/) | Ekspor PNG |
| Canvas 2D API (bawaan browser) | Graticule & label koordinat |
| Nominatim (OpenStreetMap) | Pencarian lokasi |

Tidak ada backend, tidak ada database, tidak ada pelacakan.

## 📁 Struktur

```
.
├── index.html              # Struktur halaman
├── css/
│   ├── style.css           # Tampilan editor
│   ├── formal-sheet.css    # Lembar formal "Kop Akademik"
│   └── print-layout.css    # Aturan cetak / PDF
├── js/
│   ├── app.js              # Logika utama aplikasi
│   ├── formal-layout.js    # Graticule, skala batang, format DMS
│   ├── formal-sheet.js     # Lembar 2 kolom, inset, legenda otomatis
│   └── print-layout.js     # PaperLayout: ekspor PNG & cetak
├── test/app.test.js        # Test otomatis (Playwright)
└── README.md
```

## 🎓 Tips penggunaan untuk tugas

- Gunakan peta **Satelit** untuk membatasi wilayah secara visual (sawah, pemukiman, hutan).
- Keluarkan **GeoJSON** lalu buka di **QGIS** untuk layout peta final skala besar.
- Klik kanan pada fitur di peta untuk membuka detail, atau klik item di panel kiri untuk
  lompat langsung ke lokasinya.
- Data tersimpan **per-browser** — jika ingin pindah komputer, ekspor dulu ke GeoJSON.

## ⚠️ Catatan

- Pencarian lokasi memakai Nominatim ( gratis, ada batas ~1 permintaan/detik).
- Penyimpanan di `localStorage` hanya berlaku di browser & domain yang sama.
- Untuk wilayah sangat luas, luas memakai asumsi bidang datar proyeksi Web Mercator
  (cukup akurat untuk tugas, kurang presisi untuk survei resmi).

---

Dibuat untuk mahasiswa & siapa saja yang butuh peta delinasi cepat.
