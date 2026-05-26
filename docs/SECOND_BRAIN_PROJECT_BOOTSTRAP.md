# Second Brain Project Bootstrap (Reusable)

Bu dokuman, yeni bir projede AI asistanlari (Codex, Claude vb.) ile calisirken
kalici proje hafizasi olusturmak icin kullanilan standart kurulumu anlatir.

Amac:
- Her yeni chat/oturumda hizli context yuklemek
- Is bittiginde otomatik ve tutarli log birakmak
- Projeler arasi bilgi kaybini azaltmak

## 1) Vault Yapisi

Second brain root:
- `/Users/lventctn/Documents/ikinci-beyin`

Her proje icin bir wiki klasoru:
- Ornek: `masterschool-wiki`, `xantenn-wiki`, `rifki-wiki`

Her proje wiki altinda minimum dosyalar:
- `index.md` (proje ozeti + yol haritasi linkleri)
- `log.md` (kronolojik teknik gunluk)
- `features/roadmap.md` (yapilanlar / yapilacaklar)
- `CLAUDE.md` (agent kurallari, is akis prensipleri)

## 2) Proje Icinde Scriptler

Her kod reposunda su script setini bulundur:
- `scripts/second_brain_common.sh`
- `scripts/second_brain_status.sh`
- `scripts/second_brain_pull.sh`
- `scripts/second_brain_log.sh`
- `scripts/SECOND_BRAIN_USAGE.md`

Varsayilan env degerleri:
- `SECOND_BRAIN_DIR=/Users/lventctn/Documents/ikinci-beyin`
- `SECOND_BRAIN_PROJECT=<proje-wiki-adi>`

## 3) Oturum Baslangic Rutini

Her yeni oturum/chat basinda:
1. `scripts/second_brain_status.sh`
2. `scripts/second_brain_pull.sh`

Bu iki adim, modele proje hafizasini ve son durumu hizli verir.

## 4) Is Sonu Rutini

Her anlamli gorev sonrasinda:
- `scripts/second_brain_log.sh <tip> "<kisa teknik ozet>"`

Ornekler:
- `scripts/second_brain_log.sh fix "Search preview tax breakdown iyilestirildi"`
- `scripts/second_brain_log.sh feat "Duplicate invoice kontrol akisi eklendi"`
- `scripts/second_brain_log.sh note "Deployment notlari guncellendi"`

Opsiyonel otomasyon (onerilen):
- `bash scripts/install_second_brain_git_hook.sh`
- Bu kurulumdan sonra her `git commit` sonrasinda `second_brain_log.sh auto ...` otomatik tetiklenir.
- Hook asla commit'i durdurmaz; hata olursa `.git/second_brain_hook.log` dosyasina yazar.

## 5) Yeni Projeye Uygulama

1. `ikinci-beyin` altinda yeni wiki ac:
   - `<yeni-proje>-wiki/`
2. Icinde `index.md`, `log.md`, `features/roadmap.md`, `CLAUDE.md` olustur.
3. Hedef kod reposuna second-brain scriptlerini kopyala.
4. `SECOND_BRAIN_PROJECT=<yeni-proje>-wiki` ile test et:
   - `SECOND_BRAIN_PROJECT=<yeni-proje>-wiki scripts/second_brain_status.sh`
   - `SECOND_BRAIN_PROJECT=<yeni-proje>-wiki scripts/second_brain_pull.sh`
   - `SECOND_BRAIN_PROJECT=<yeni-proje>-wiki scripts/second_brain_log.sh note "bootstrap test"`

## 6) Beklenen Sonuc

Bu yapiyla modelin dogrudan kalici hafizasi olmasa da:
- Her oturumda ayni kaynaktan context yuklenir
- Is ciktilari tutarli sekilde proje loguna yazilir
- Farkli chat/model gecislerinde bilgi devamlıligi korunur
