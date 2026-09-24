const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const p = await b.newPage({ viewport:{width:1500,height:950} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://' + path.resolve('index.html') + '?nohelp');
  await p.waitForSelector('.leaflet-container'); await p.waitForTimeout(1300);
  await p.locator('[data-tpl="formal"]').click(); await p.waitForTimeout(1200);

  console.log('1. awal: logo ada?', await p.evaluate(()=>({ada:!!document.querySelector('.fl-kop-logo img'), placeholder:!!document.querySelector('.fl-kop-logo svg')})));
  console.log('   tombol hapus disabled:', await p.locator('#logo-remove-btn').isDisabled());

  // Buat file PNG uji (kotak merah 400x200) lalu unggah
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAZAAAADIAQMAAABcHxr+AAAABlBMVEX/AAD///9BHTaqAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAOBrAB+AAAG8DQ0iAAAAAElFTkSuQmCC','base64');
  

  await p.locator('#logo-input').setInputFiles(path.resolve('logo-uji.png'));
  await p.waitForTimeout(1500);
  console.log('2. setelah unggah:', await p.evaluate(()=>({
    imgDiPreview: !!document.querySelector('#logo-preview img'),
    imgDiSheet: !!document.querySelector('.fl-kop-logo img'),
    hasLogoClass: document.querySelector('.fl-kop-logo').classList.contains('has-logo'),
    srcPanjang: (layout.kop.logo||'').slice(0,22),
    tersimpan: !!JSON.parse(localStorage.getItem('delinaisi-maker-v1')||'{}').layout?.kop?.logo
  })));
  console.log('   tombol hapus disabled:', await p.locator('#logo-remove-btn').isDisabled());

  // Posisi teks
  console.log('3. posisi teks:');
  const rows = await p.evaluate(() => {
    const panel = document.querySelector('.fl-panel').getBoundingClientRect();
    return Array.from(document.querySelectorAll('.fl-panel > .fl-block')).map(b => {
      const r = b.getBoundingClientRect();
      return { blok: (b.className.replace('fl-block','').trim()||'lain'), align: getComputedStyle(b).textAlign,
               x: Math.round(r.x - panel.x), w: Math.round(r.width) };
    });
  });
  rows.forEach(r=>console.log(`   x=${String(r.x).padStart(3)} w=${String(r.w).padStart(3)} align=${r.align.padEnd(7)} ${r.blok}`));

  // Blok pengesahan harus di kanan
  console.log('4. blok pengesahan:', await p.evaluate(() => {
    const s = document.querySelector('.fl-sign').getBoundingClientRect();
    const blk = document.querySelector('.fl-block--sign').getBoundingClientRect();
    return { lebarTandaTangan: Math.round(s.width), marginKanan: Math.round(blk.right - s.right),
             rataKanan: Math.abs(blk.right - s.right) < 20 };
  }));

  // Hapus logo
  await p.locator('#logo-remove-btn').click(); await p.waitForTimeout(800);
  console.log('5. setelah hapus:', await p.evaluate(()=>({
    imgDiSheet: !!document.querySelector('.fl-kop-logo img'),
    placeholder: !!document.querySelector('.fl-kop-logo svg'),
    tersimpanKosong: !JSON.parse(localStorage.getItem('delinaisi-maker-v1')).layout.kop.logo
  })));

  console.log('=== ERRORS ==='); errs.forEach(e=>console.log(e)); if(!errs.length) console.log('(none)');
  await b.close();
})();
