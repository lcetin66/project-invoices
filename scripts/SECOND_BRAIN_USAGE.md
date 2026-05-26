# Second Brain Quick Usage

Varsayilan hedef:
- `SECOND_BRAIN_DIR=/Users/lventctn/Documents/ikinci-beyin`
- `SECOND_BRAIN_PROJECT=masterschool-wiki`

## 1) Baglanti ve dosya kontrolu
```bash
scripts/second_brain_status.sh
```

## 2) Oturum basi context cekme
```bash
scripts/second_brain_pull.sh
```

## 3) Log kaydi ekleme
```bash
scripts/second_brain_log.sh fix "Search preview tax lines guncellendi"
```

## 3.1) Otomatik log (git commit sonrasi)
```bash
bash scripts/install_second_brain_git_hook.sh
```

Kontrol:
```bash
ls -la .git/hooks/post-commit
tail -n 50 .git/second_brain_hook.log
```

## 4) Farkli wiki ile calisma
```bash
SECOND_BRAIN_PROJECT=rifki-wiki scripts/second_brain_pull.sh
SECOND_BRAIN_PROJECT=rifki-wiki scripts/second_brain_log.sh note "Rifki icin test kaydi"
```
