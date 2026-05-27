# RechnungsManager

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)
![Flask API](https://img.shields.io/badge/API-Flask-000000?logo=flask)
![MySQL](https://img.shields.io/badge/Database-MySQL-4479A1?logo=mysql&logoColor=white)
![License](https://img.shields.io/badge/License-Private-red)

Tam kapsamli fatura yonetimi ve AI destekli veri cikarma platformu.
Proje, **Next.js App Router** tabanli web uygulamasi ile **Python Flask classifier API** katmanini birlikte calistirir.

## Icerik

- [Genel Bakis](#genel-bakis)
- [Temel Ozellikler](#temel-ozellikler)
- [Teknik Mimari](#teknik-mimari)
- [Proje Agaci](#proje-agaci)
- [Gereksinimler](#gereksinimler)
- [Kurulum (Local Development)](#kurulum-local-development)
- [Calistirma](#calistirma)
- [Environment Degiskenleri](#environment-degiskenleri)
- [API Akis Ozetleri](#api-akis-ozetleri)
- [Production / Hosting](#production--hosting)
- [Second Brain Entegrasyonu](#second-brain-entegrasyonu)
- [Troubleshooting](#troubleshooting)

## Genel Bakis

RechnungsManager su problemlere odaklanir:

- Fatura dosyalarini tek bir yerden toplama (image/pdf)
- OCR + AI ile tedarikci, tutar, vergi, tarih gibi alanlari otomatik cikarma
- Kategori, butce ve raporlama akislarini tek panelde yonetme
- Arama, onizleme, duzenleme ve dogrulama sureclerini hizlandirma

## Temel Ozellikler

- Guvenli giris/cikis ve oturum yonetimi
- Fatura yukleme ve AI siniflandirma
- Duzenlenebilir fatura detay sayfasi (zoom/pan + metadata)
- Gelismis arama sayfasi (inline preview + detay paneli)
- Kategori ve butce yonetimi
- KPI, grafikler ve dashboard analitikleri
- Duplicate kontrolu ve dogrulama popup'lari

## Teknik Mimari

### 1) Next.js Katmani (`nextjs-app`)

- UI + server components + route handlers
- Kimlik dogrulama, veritabani islemleri, dosya servisleme
- Python classifier API ile HTTP uzerinden haberlesme

### 2) Python Classifier Katmani (`api`, `classifier`)

- Flask tabanli servis
- OCR, on-isleme, AI tabanli alan cikarma
- Next.js tarafina normalize edilmis sonuc doner

### 3) Veri Katmani (`MySQL` + `uploads/`)

- MySQL: fatura, kategori, ayar, rapor verileri
- `uploads/`: hem Next.js hem Python tarafinin paylastigi dosya klasoru

## Proje Agaci

```text
.
|-- api/
|   `-- classifier_api.py
|-- classifier/
|   |-- ocr_engine.py
|   |-- image_preprocess.py
|   `-- ...
|-- nextjs-app/
|   |-- app/
|   |-- components/
|   |-- lib/
|   |-- lang/
|   `-- package.json
|-- scripts/
|   |-- start_api.sh
|   |-- hosting_bootstrap.sh
|   |-- hosting_start.sh
|   |-- second_brain_log.sh
|   |-- second_brain_pull.sh
|   `-- second_brain_status.sh
|-- sql/
|   `-- schema.sql
|-- uploads/
|-- requirements.txt
`-- README.md
```

## Gereksinimler

- Node.js 20+
- Python 3.8+
- MySQL 8+
- macOS/Linux terminal (script kullanimi icin)

## Kurulum (Local Development)

### 1) Veritabani hazirla

```bash
mysql -u root -p < sql/schema.sql
```

### 2) Python API kurulumu

Proje kokunden:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Next.js kurulumu

```bash
cd nextjs-app
cp .env.example .env.local
npm install
```

## Calistirma

Iki ayri terminal onerilir.

### Terminal A: Python classifier API

```bash
./scripts/start_api.sh
```

Default: `http://127.0.0.1:8000`

Health check:

```bash
curl -i http://127.0.0.1:8000/api/kategorien
```

### Terminal B: Next.js

```bash
cd nextjs-app
npm run dev
```

App: `http://localhost:3000`

## Environment Degiskenleri

`nextjs-app/.env.local` icin minimum ornek:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=firma_rechnungen
DB_USER=root
DB_PASS=

CLASSIFIER_API_URL=http://127.0.0.1:8000
SESSION_SECRET=replace-with-a-long-random-secret
UPLOAD_DIR=../uploads
```

Root `.env` dosyasinda production/AI anahtarlari tutulabilir.

## API Akis Ozetleri

- Upload + classify:
  - `nextjs-app/api/invoices` -> `api/classifier_api.py` (`/api/klassifizieren`)
- Invoices CRUD:
  - `nextjs-app/api/invoices`, `nextjs-app/api/invoices/[id]`
- Categories:
  - `nextjs-app/api/categories*`
- Stats/insights:
  - `nextjs-app/api/stats` -> Python insight endpointleri

## Production / Hosting

### Build

```bash
cd nextjs-app
npm run build
npm run start
```

### Script tabanli hizli kurulum

```bash
./scripts/hosting_bootstrap.sh
./scripts/hosting_start.sh
pm2 status
```

PM2 autostart:

```bash
pm2 startup
pm2 save
```

## Second Brain Entegrasyonu

Bu repoda second brain yardimci scriptleri vardir:

- `scripts/second_brain_log.sh`
- `scripts/second_brain_pull.sh`
- `scripts/second_brain_status.sh`
- `scripts/install_second_brain_git_hook.sh`

Varsayilan second brain dizini:

- `/Users/lventctn/Documents/ikinci-beyin`
- Proje wiki: `masterschool-wiki`
- Log: `/Users/lventctn/Documents/ikinci-beyin/masterschool-wiki/log.md`

Detayli kullanim:

- `scripts/SECOND_BRAIN_USAGE.md`
- `docs/SECOND_BRAIN_PROJECT_BOOTSTRAP.md`

## Troubleshooting

1. `Nicht autorisiert` hatasi
- Yeniden login ol.
- Browser cookie ayarlarini kontrol et.

2. Classifier API baglanti hatasi
- `./scripts/start_api.sh` calisiyor mu kontrol et.
- `CLASSIFIER_API_URL` degerini dogrula.

3. Veritabani baglanti hatasi
- `nextjs-app/.env.local` DB alanlarini kontrol et.
- `firma_rechnungen` olusturulmus mu dogrula.

4. Upload var ama sonuc bos/zayif
- Gorsel kalitesini ve crop/rotation durumunu kontrol et.
- Python API loglarinda OCR/AI warning satirlarini incele.
