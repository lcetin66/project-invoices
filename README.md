# RechnungsManager (Next.js + Python AI)

Bu proje artık **Next.js frontend/backend (App Router)** üzerinde çalışır.
AI sınıflandırma akışı ise aynen **Python Flask API** (`api/classifier_api.py`) tarafında kalır.

## Mimari

- `nextjs-app/`: Yeni Next.js uygulaması (login, upload, invoices, admin)
- `api/classifier_api.py`: Python AI sınıflandırma API'si
- `classifier/`: OCR + AI sınıflandırma motoru
- `sql/schema.sql`: MySQL şeması
- `uploads/`: Yüklenen dosyalar (Next.js ve Python tarafından ortak kullanılır)

## Gereksinimler

- Python 3.8+
- Node.js 20+
- MySQL (XAMPP/MySQL Server olabilir)

## 1) Veritabanını hazırlama

1. MySQL'i başlat.
2. `sql/schema.sql` dosyasını içe aktar.

Örnek (terminal):

```bash
mysql -u root -p < sql/schema.sql
```

## 2) Python AI API kurulum ve çalıştırma

Proje kökünde:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

API başlat:

```bash
./scripts/start_api.sh
```

Varsayılan API adresi:

- `http://127.0.0.1:8000`

Kontrol:

```bash
curl -i http://127.0.0.1:8000/api/kategorien
```

## 3) Next.js uygulamasını ayarlama

```bash
cd nextjs-app
cp .env.example .env.local
```

`nextjs-app/.env.local` içinde en az şu değerleri kontrol et:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=firma_rechnungen
DB_USER=root
DB_PASS=

CLASSIFIER_API_URL=http://127.0.0.1:8000
SESSION_SECRET=buraya-uzun-rastgele-bir-secret-yaz
UPLOAD_DIR=../uploads
```

Ardından bağımlılık kur:

```bash
npm install
```

Geliştirme sunucusunu başlat:

```bash
npm run dev
```

Uygulama adresi:

- `http://localhost:3000`

## 4) Giriş

Varsayılan kullanıcı:

- Benutzername: `admin`
- Passwort: `admin123`

## 5) Üretim (production)

```bash
cd nextjs-app
npm run build
npm run start
```

## Özellik eşlemesi (PHP -> Next.js)

- Login/Logout: Next API (`/api/auth/*`) + cookie session
- Rechnung Upload + AI classify: Next `/api/invoices` -> Python `/api/klassifizieren`
- Rechnungen listeleme/düzenleme/silme: Next `/api/invoices`, `/api/invoices/[id]`
- Kategori + bütçe yönetimi: Next `/api/categories*`
- AI ayarları (provider/model/key): Next `/api/settings/ai`
- KPI + AI insights: Next `/api/stats` -> Python `/api/business_insights`

## Notlar

- Python API kapalıysa upload/classification çalışmaz.
- Dosyalar `uploads/` klasöründe tutulur.
- AI key'i Admin sayfasından kaydedebilirsin.
- Proje PHP içermez; tek akış Next.js + Python API'dir.

## Sorun giderme

1. `Nicht autorisiert` hatası:
- Tekrar login ol.
- Tarayıcıda cookie engeli olmadığını kontrol et.

2. `Classifier API error` hatası:
- Python API'nin açık olduğundan emin ol (`curl` ile test et).
- `CLASSIFIER_API_URL` değerini kontrol et.

3. DB bağlantı hatası:
- `nextjs-app/.env.local` içindeki DB ayarlarını doğrula.
- `firma_rechnungen` veritabanının oluştuğunu kontrol et.

## Hosting (Production) Hızlı Kurulum

Sunucuda proje dizininde:

```bash
cp nextjs-app/.env.example nextjs-app/.env.local
# nextjs-app/.env.local degerlerini doldur
# kok dizindeki .env dosyasina OPENAI_API_KEY vb degerleri gir
```

Kurulum + build:

```bash
./scripts/hosting_bootstrap.sh
```

PM2 ile başlatma:

```bash
./scripts/hosting_start.sh
pm2 status
```

PM2 autostart:

```bash
pm2 startup
pm2 save
```
