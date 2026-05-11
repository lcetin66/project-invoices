1. Metni mümkünse önce sadeleştir 🧹
Tekrar eden cümleleri at
“Laf kalabalığı”nı temizle
Gereksiz selamlama / imza bloklarını çıkar (özellikle e‑mail forward zincirlerinde)

2. Uzun şeyleri böl 👇
+ sayfalık doküman / blog / senaryo:
Tamamını tek seferde verme
Bölüm bölüm gönder: Bölüm 1/5, 2/5 gibi
Her seferinde modele kısa bir özet hatırlat:
“Önceki bölümde X’ten bahsettik, şimdi Y’yi analiz et”

3. Token tahmini için kaba kural kullan 📏
Kafanda şu heuristi tut:
≈4 karakter ≈ 1 token (boşluklar dahil)
2.000 karakterlik bir metin → yaklaşık 500 token
Çoğu günlük e‑mail → 100–500 token bandında
Çok uzun blog / rapor → rahatça 5.000+ token olabilir

4. Context window’u unutma 🧠
Kullandığın modelin penceresi ne? Örn:
4k, 8k, 16k, 128k…
Hesap hep şöyle:
Toplam ≈ (önceki konuşma + şu anki prompt + beklenen cevap)
Limitin %70–80’ini geçmemek genelde güvenli alan.

5. Cevap uzunluğunu bilinçli sınırla ✂️
Çok uzun cevap isteme, daha çok adım adım iste:
“Önce sadece özet ver”
“Şimdi 1. bölümü detaylandır”
max 200–400 token gibi sınırlı cevaplar:
Hem daha hızlı
Hem de kota dostu

6. Büyük işi parçalara ayır 🧩

Aynı context’e her şeyi doldurmaya çalışma, görevi ayır:
1.adım: “Metni özetle”
2.adım: “Bu özetten maddeler üret”
3.adım: “Sadece şu maddeyi detaylandır”