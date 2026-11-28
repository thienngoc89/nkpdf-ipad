const CACHE_NAME = 'nkpdf-ipad-v20261128.154212';
const ASSETS = [
  './',
  './index.html',
  './tv.html',
  './styles.css',
  './icons_nkpdf.js',
  './ink_engine.js',
  './app.js',
  './manifest.json',
  './sample.pdf',
  './de_vat_ly/catalog.json',
  './de_toan/catalog.json',
  './de_hoa/catalog.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/katex.min.js',
  './vendor/katex.min.css',
  './vendor/mqtt.min.js',
  './kho_hinh/Toan_Hoc/Do_Thi/Do_thi_Parabol.png',
  './kho_hinh/Toan_Hoc/Hinh_Khong_Gian/Chop_tam_giac_S_ABC.png',
  './kho_hinh/Toan_Hoc/Hinh_Khong_Gian/Chop_tu_giac_S_ABCD.png',
  './kho_hinh/Toan_Hoc/Hinh_Phang/Duong_tron_luong_giac_Oxy.png',
  './kho_hinh/Toan_Hoc/Hinh_Phang/Hinh_binh_hanh_ABCD.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Chuyen_dong_nem_ngang.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Chuyen_dong_nem_xien.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Con_lac_don.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Con_lac_don_dao_dong.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Con_lac_lo_xo_nam_ngang.png',
  './kho_hinh/Vat_Ly/Co_Hoc/Con_lac_lo_xo_thang_dung.png',
  './kho_hinh/Vat_Ly/Dao_Dong_Song/Do_thi_sin_cos_dao_dong.png',
  './kho_hinh/Vat_Ly/Dao_Dong_Song/Giao_thoa_song_hai_nguon.png',
  './kho_hinh/Vat_Ly/Dao_Dong_Song/Song_dung_tren_day.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS) {
        try {
          await cache.add(url);
        } catch (_) {}
      }
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((networkResp) => {
        if (networkResp && networkResp.status === 200) {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResp;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html', { ignoreSearch: true });
        }
        return Response.error();
      })
  );
});
