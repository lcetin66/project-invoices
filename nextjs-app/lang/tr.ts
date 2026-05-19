export const tr = {
  app: {
    name: "RechnungsManager",
    logout: "Çıkış",
    footer: "Tüm hakları saklıdır."
  },
  nav: {
    input: "Giriş",
    admin: "Yönetim",
    invoices: "Faturalar"
  },
  login: {
    title: "Hoş geldin!",
    subtitle: "Faturalarını yönetmek için giriş yap.",
    username: "Kullanıcı adı",
    usernamePlaceholder: "Kullanıcı adın",
    password: "Şifre",
    passwordPlaceholder: "Şifren",
    submit: "Giriş yap",
    submitting: "Giriş yapılıyor...",
    invalid: "Kullanıcı adı veya şifre hatalı.",
    failed: "Giriş başarısız.",
    standard: "Standart"
  },
  dashboard: {
    openDebug: "Debug panelini aç",
    closeDebug: "Debug panelini kapat",
    uploadTitle: "Fatura yükle",
    uploadGreeting: "Hoş geldin {username}. Faturanı PDF veya görsel olarak yükle. AI sınıflandırma Python üzerinde çalışır.",
    chooseFile: "Dosya seç",
    upload: "Yükle",
    processing: "İşleniyor...",
    type: "Tür",
    invoiceDate: "Fatura tarihi",
    dueDate: "Vade tarihi",
    description: "Açıklama",
    note: "Not",
    latestInvoices: "Son faturalar",
    noInvoices: "Henüz fatura yok.",
    debugTitle: "Debug Monitörü",
    clear: "Temizle",
    minimize: "Küçült",
    open: "Aç",
    entries: "Kayıt",
    runtime: "Aktif süre",
    noDebug: "Henüz debug kaydı yok."
  }
} as const;
