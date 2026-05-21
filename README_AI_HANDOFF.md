# AI Handoff - Image Classification Issue

## Context
- Project migrated from PHP to Next.js + Python API.
- PDF flow works.
- Image flow is broken: upload completes but extracted fields are mostly empty (`lieferant=Unbekannt`, `brutto=0`, category fallback).
- UI shows success, but data quality is wrong.

## Current Critical Symptom
- Debug panel repeatedly shows:
  - `Rechnung erfolgreich verarbeitet`
  - `OCR-Diagnose ... Textlänge: 0`
  - `Teilweise Erkennung ... Bildrechnung wurde nur teilweise erkannt`
- This means image extraction path returns no usable parsed payload.

## Target Behavior
- For image uploads (`jpg/png/webp/heic`), backend should:
  1. Send image directly to OpenAI vision.
  2. Receive JSON with invoice fields.
  3. Save these fields in DB and show them in edit/result UI.
- No local OCR dependency for image primary path.

## What To Verify First
1. Confirm which model is actually called in runtime.
2. Confirm OpenAI response status/body for image request.
3. Confirm JSON parsing path in Python does not silently swallow errors.
4. Confirm Next API route does not overwrite/zero out valid parsed data.

## Files To Inspect (Priority Order)

### 1) Image -> OpenAI -> JSON (core logic)
- `classifier/ocr_engine.py`
  - `_vision_klassifizieren(...)`
  - `klassifizieren(...)`
  - model selection/fallback
  - image payload format (`image_url`, prompt, response parsing)

### 2) Pipeline entry + debug payload
- `main.py`
  - `process_invoice_file(...)`
  - `debug` object returned to API

### 3) Python HTTP API
- `api/classifier_api.py`
  - `/api/klassifizieren` endpoint
  - forwarding result/debug to Next.js

### 4) Next.js server route for uploads
- `nextjs-app/app/api/invoices/route.ts`
  - `classifyWithPython(...)` call
  - weak extraction guard and warning logic
  - any fallback that can force empty fields

### 5) Next.js Python bridge
- `nextjs-app/lib/python-api.ts`
  - model/provider forwarded to Python
  - default model normalization

### 6) Frontend debug/result rendering
- `nextjs-app/components/DashboardClient.tsx`
  - debug output (`OCR-Diagnose`, `Vision: ...`)
  - result mapping from API response

### 7) AI settings / model defaults
- `nextjs-app/lib/constants.ts`
- `nextjs-app/app/api/settings/ai/route.ts`
- `.env`
- `nextjs-app/.env.local`

## Known Risk Areas
- Model availability mismatch (`gpt-5.4-mini`/`gpt-5.4-nano` not available for account or endpoint).
- Response schema mismatch (non-JSON text despite prompt).
- OpenRouter vs OpenAI direct provider mismatch.
- Silent exception handling in `_vision_klassifizieren` returning `{}`.
- Route-level weak extraction acceptance hides root cause by saving partial invoice.

## Required Debug Improvements (if still unresolved)
1. Log and expose in debug panel:
   - provider
   - model attempted
   - HTTP status
   - first 300-500 chars of response/error body
2. Ensure each model fallback attempt is visible in debug.
3. Do not swallow exceptions without preserving message in debug payload.

## Reproduction
1. Start Python API.
2. Start Next.js app.
3. Login and upload same failing image (`2026-04-24_12-25.png`).
4. Capture debug panel lines and server logs for the same request timestamp.

## Expected Fix Direction
- Keep image path as direct vision.
- Make vision response handling strict and observable.
- Use model fallback only with explicit per-attempt diagnostics.
- Stop returning silent `{}` on parse/API failures; return structured debug reason.
