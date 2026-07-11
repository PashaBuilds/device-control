/** Tüm arayüz metinleri. İleride i18n gerekirse tek değişim noktası burasıdır. */
export const tr = {
  appName: 'Cihaz Kontrol',
  appSubtitle: 'TCP/IP Enstrüman Paneli',

  categories: {
    'power-supply': 'Güç Kaynakları',
    'debug-probe': 'Debug Probları'
  },

  sidebar: {
    addDevice: 'Cihaz Ekle',
    removeDevice: 'Cihazı kaldır',
    removeConfirm: (name: string) =>
      `"${name}" kaldırılsın mı? Bu işlem cihaz bağlantısını keser ve kaydı siler.`
  },

  state: {
    disconnected: 'Bağlı değil',
    connecting: 'Bağlanıyor…',
    connected: 'Bağlı',
    reconnecting: 'Yeniden bağlanıyor…',
    error: 'Hata'
  },

  empty: {
    title: 'Cihaz yok',
    body: 'Başlamak için ağdaki bir cihazı ekleyin. Cihazlar IP adresi ve port ile tanımlanır; kayıtlar bu bilgisayarda saklanır.',
    action: 'İlk cihazı ekle'
  },

  addDialog: {
    title: 'Yeni Cihaz',
    type: 'Cihaz türü',
    name: 'Ad',
    namePlaceholder: 'ör. Masa 1 — Güç Kaynağı',
    host: 'IP adresi / sunucu adı',
    hostPlaceholder: '192.168.1.50',
    port: 'Port',
    cancel: 'Vazgeç',
    add: 'Ekle',
    errors: {
      nameRequired: 'Ad boş olamaz.',
      hostInvalid: 'Geçerli bir IP adresi veya sunucu adı girin.',
      portInvalid: 'Port 1–65535 aralığında olmalı.'
    }
  },

  panel: {
    connect: 'Bağlan',
    disconnect: 'Bağlantıyı Kes',
    allOn: 'Tümünü Aç',
    allOff: 'Tümünü Kapat',
    tracking: 'İzleme Modu',
    trackingHint: 'Kanal 2, Kanal 1 gerilimini izler (CONFIG 0)',
    lock: 'Kilit',
    locked: 'Kilitli',
    lockHintOff: 'Ayar kilidi: gerilim/akım/OVP/OCP değerlerini yanlışlıkla değişime karşı korur. Çıkış aç/kapat etkilenmez.',
    lockHintOn: 'Ayar kilidi etkin — değerleri değiştirmek için kilidi açın. Çıkış aç/kapat çalışmaya devam eder.',
    notConnected: 'Cihaz bağlı değil. Kontroller bağlantı kurulunca etkinleşir.',
    channel: (n: number) => `Kanal ${n}`,
    output: 'Çıkış',
    outputOn: 'AÇIK',
    outputOff: 'KAPALI',
    setpoints: 'Ayar Değerleri',
    vSet: 'Gerilim',
    iSet: 'Akım Limiti',
    ovp: 'OVP',
    ocp: 'OCP',
    apply: 'Uygula',
    measured: 'Ölçülen',
    mode: { cv: 'CV', cc: 'CC', off: '—' },
    trip: {
      ovp: (ch: number) => `Kanal ${ch}: Aşırı gerilim koruması (OVP) tetiklendi`,
      ocp: (ch: number) => `Kanal ${ch}: Aşırı akım koruması (OCP) tetiklendi`,
      other: (ch: number) => `Kanal ${ch}: Koruma tetiklendi`,
      reset: 'Korumayı Sıfırla'
    }
  },

  probe: {
    vivado: 'Vivado / hw_server Bağlantısı',
    vivadoHint: 'Vivado Hardware Manager → Open Target → bu adresi girin',
    copy: 'Kopyala',
    copied: 'Kopyalandı ✓',
    agent: 'Agent Kimliği',
    services: 'TCF Servisleri',
    jtag: 'JTAG Zinciri',
    jtagEmpty: 'JTAG hedefi bildirilmedi — zincir boş olabilir ya da cihaz taramayı desteklemiyor.',
    servicesEmpty: 'Servis bilgisi bağlantı kurulunca gelir.',
    consoleTitle: 'TCF Konsolu',
    consolePlaceholder: 'Komut girin — ör. Locator getAgentID  veya  Jtag getChildren ""  (Enter: gönder, ↑↓: geçmiş)'
  },

  chart: {
    title: 'Trend',
    window1m: '1 dk',
    window5m: '5 dk',
    window30m: '30 dk',
    exportCsv: 'CSV Dışa Aktar',
    voltage: (ch: number) => `K${ch} Gerilim`,
    current: (ch: number) => `K${ch} Akım`
  },

  console: {
    title: 'SCPI Konsolu',
    showPolling: 'Yoklama trafiğini göster',
    showPollingHint:
      'Uygulamanın ölçüm/durum için arka planda gönderdiği komutları da listeler (varsayılan: gizli)',
    placeholder: 'Komut girin — ör. *IDN? veya V1 12.5  (Enter: gönder, ↑↓: geçmiş)',
    open: 'Konsolu Aç',
    close: 'Konsolu Kapat',
    empty: 'Henüz trafik yok. Bağlantı kurulduğunda gönderilen tüm komutlar burada listelenir.'
  },

  errors: {
    generic: 'İşlem başarısız oldu',
    range: (min: number, max: number, unit: string) => `Değer ${min}–${max} ${unit} aralığında olmalı.`
  }
} as const
