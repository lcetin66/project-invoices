# RechnungsManager (Next.js + Python AI)

This project runs on a **Next.js frontend/backend (App Router)** stack.
The AI classification pipeline is handled by the **Python Flask API** in `api/classifier_api.py`.

## Architecture

- `nextjs-app/`: Next.js application (login, upload, invoices, admin)
- `api/classifier_api.py`: Python AI classification API
- `classifier/`: image preprocessing + OCR/AI extraction engine
- `sql/schema.sql`: MySQL schema
- `uploads/`: shared upload directory (used by both Next.js and Python)

## Requirements

- Python 3.8+
- Node.js 20+
- MySQL server

## 1) Prepare the database

1. Start MySQL.
2. Import `sql/schema.sql`.

Example:

```bash
mysql -u root -p < sql/schema.sql
```

## 2) Set up and run the Python AI API

From the project root:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the API:

```bash
./scripts/start_api.sh
```

Default API URL:

- `http://127.0.0.1:8000`

Health check:

```bash
curl -i http://127.0.0.1:8000/api/kategorien
```

## 3) Set up the Next.js app

```bash
cd nextjs-app
cp .env.example .env.local
```

At minimum, verify these values in `nextjs-app/.env.local`:

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

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

App URL:

- `http://localhost:3000`

## 4) Login

Default user:

- Username: `admin`
- Password: `admin123`

## 5) Production

```bash
cd nextjs-app
npm run build
npm run start
```

## Feature Mapping (PHP -> Next.js)

- Login/Logout: Next API (`/api/auth/*`) + cookie session
- Invoice upload + AI classify: Next `/api/invoices` -> Python `/api/klassifizieren`
- Invoice list/edit/delete: Next `/api/invoices`, `/api/invoices/[id]`
- Category + budget management: Next `/api/categories*`
- AI settings (provider/model/key): Next `/api/settings/ai`
- KPI + AI insights: Next `/api/stats` -> Python `/api/business_insights`

## Notes

- Upload/classification will not work if the Python API is down.
- Files are stored in `uploads/`.
- AI key can be saved from the Admin page.
- The active stack is Next.js + Python API.

## Troubleshooting

1. `Nicht autorisiert` error:
- Log in again.
- Make sure browser cookies are not blocked.

2. `Classifier API error`:
- Confirm the Python API is running (test with `curl`).
- Check `CLASSIFIER_API_URL`.

3. Database connection error:
- Verify DB settings in `nextjs-app/.env.local`.
- Ensure the `firma_rechnungen` database exists.

## Hosting (Production) Quick Setup

On the server, in the project directory:

```bash
cp nextjs-app/.env.example nextjs-app/.env.local
# fill values in nextjs-app/.env.local
# set OPENAI_API_KEY and other secrets in root .env
```

Install + build:

```bash
./scripts/hosting_bootstrap.sh
```

Start with PM2:

```bash
./scripts/hosting_start.sh
pm2 status
```

Enable PM2 autostart:

```bash
pm2 startup
pm2 save
```
