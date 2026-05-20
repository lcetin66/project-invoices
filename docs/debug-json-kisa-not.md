# Debug JSON Kısa Not

- Kullanıcı beklentisi: uzun JSON formatı korunacak, özellikle `mwst_*_1/_2` alanları doğru doldurulacak.
- `debug-json` ekranında sadece:
  - Giden JSON
  - Dönen JSON
  - Kopyala butonları
- Giden JSON içinde istek parametreleri görünür olmalı:
  - `model`
  - `temperature`
  - `max_tokens`
  - `roles`
  - `system_role`
  - `response_format`
- Görsel ve JSON panelleri kendi içinde scroll olmalı (uzun boşluk olmamalı).

## 2026-05-20 Dil/I18n Notu

- Tüm görünen Next.js metinleri `nextjs-app/lang/de.ts` içine toplandı.
- `nextjs-app/lang/tr.ts`, bilinçli olarak Almanca sözlüğe alias edildi; uygulama hangi locale ile açılsa da görünen metin Almanca kalır.
- Ana ekranlar değişken sözlükten besleniyor:
  - `DashboardClient`
  - `InvoicesClient`
  - `AdminClient`
  - `UserClient`
  - `JsonDebugClient`
  - `NavBar`
- Kullanıcıya dönen API mesajları da aynı sözlüğe bağlandı:
  - login
  - invoices
  - categories
  - budgets
  - stats
  - user/profile
  - debug-json
  - AI settings
- Build kontrolü: `npm run build` başarılı.

## 2026-05-20 Dil Dosyaları Genişletme

- Dil yapısı üç dosyaya tamamlandı:
  - `nextjs-app/lang/de.ts`
  - `nextjs-app/lang/tr.ts`
  - `nextjs-app/lang/en.ts`
- `nextjs-app/lang/index.ts` artık `NEXT_PUBLIC_APP_LANG=de|tr|en` seçimini destekliyor.
- `LocaleDict` tipi eklendi; Türkçe ve İngilizce sözlükler Almanca ile aynı anahtar yapısına sahip olmak zorunda.
- Build kontrolü: `npm run build` başarılı.

## 2026-05-20 Kullanıcı Dil Seçimi ve Upload Temizliği

- Kullanıcı sayfasına dil seçimi dropdown eklendi.
- Seçilen dil `localStorage` içinde `rechnung_app_lang` anahtarıyla tutuluyor.
- Desteklenen diller: `de`, `tr`, `en`.
- Dil değişince sayfa yenileniyor ve client sözlüğü yeni dile göre yükleniyor.
- Rechnungen sayfasında fatura silinince DB kaydıyla ilişkili upload dosyası da `uploads` klasöründen `force` ile siliniyor.
- Aynı dosya adı Python API temizleme endpointine de gönderiliyor.
- Build kontrolü: `npm run build` başarılı.

## 2026-05-20 Hydration Düzeltmesi

- Dil seçimi nedeniyle oluşan hydration hatası giderildi.
- `lang/index.ts` artık import sırasında `window.localStorage` okumuyor.
- Client dil değişimi `LanguageProvider` üzerinden yapılıyor.
- İlk render server/client aynı sözlükle başlıyor, seçili dil mount sonrası güvenli uygulanıyor.
- `NavBar` link etiketleri render içinde üretildi; eski modül-seviyesi sözlük okuması kaldırıldı.
- Browser kontrolü: dashboard üzerinde hydration overlay yok, hydration error log yok.
