const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const pagesToScreenshot = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Eingabe', path: '/input' },
  { name: 'Verwaltung', path: '/admin' },
  { name: 'Rechnungen', path: '/invoices' },
  { name: 'Suche', path: '/search' },
  { name: 'Benutzer', path: '/user' },
];

async function run() {
  const outputDir = path.join(__dirname, 'github_screenshots');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  console.log('Tarayıcı başlatılıyor (Playwright)...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    
    // Set cookie to bypass login via demo mode
    await context.addCookies([{
      name: 'rm_demo_mode',
      value: '1',
      url: BASE_URL,
      path: '/'
    }]);

    const page = await context.newPage();

    for (const p of pagesToScreenshot) {
      console.log(`Ziyaret ediliyor: ${p.name} (${BASE_URL}${p.path})`);
      
      try {
        await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'networkidle' });
      } catch (e) {
        console.log(`Hata oluştu veya zaman aşımı: ${e.message}`);
      }

      if (p.path === '/search') {
        try {
          await page.locator('input[type="search"]').fill('LIDL');
          await page.waitForTimeout(2500);
        } catch (e) {
          console.log(`Arama doldurulamadı: ${e.message}`);
        }
      }
      
      // Wait a bit extra for animations / charts to render fully
      await page.waitForTimeout(2500);

      const outPath = path.join(outputDir, `${p.name.toLowerCase()}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`Ekran görüntüsü kaydedildi: ${outPath}`);
    }

  } catch (err) {
    console.error('Hata oluştu:', err);
  } finally {
    await browser.close();
    console.log('İşlem tamamlandı. Ekran görüntüleri github_screenshots klasöründe hazır.');
  }
}

run();
