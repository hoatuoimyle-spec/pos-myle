const CACHE_NAME = 'myle-pos-cache-v5'; // Cập nhật phiên bản Cache
const API_URL = "https://script.google.com/macros/s/AKfycbxz7SzvgAEcbWjl2qng1VlP9xG29VDyJmLCtOXzUHKs9zpqbH490G98kkBg2LdPhQv1Ug/exec";

// Cài đặt Service Worker
self.addEventListener('install', event => {
  self.skipWaiting(); // Ép kích hoạt ngay lập tức bản V3
});

// Xóa bộ nhớ đệm cũ khi kích hoạt bản mới
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Cache tài nguyên cơ bản (Bỏ qua API)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('script.google.com')) return;
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchRes => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, fetchRes.clone());
          return fetchRes;
        });
      });
    }).catch(() => new Response("Network error"))
  );
});

// LẮNG NGHE SỰ KIỆN BACKGROUND SYNC TỪ HỆ ĐIỀU HÀNH
self.addEventListener('sync', event => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOfflineOrders());
  }
});

// Kết nối IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MyLePOS_DB', 2);
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

// Hàm đồng bộ ngầm
async function syncOfflineOrders() {
  try {
    const db = await openDatabase();
    
    const orders = await new Promise((resolve, reject) => {
      const tx = db.transaction('OfflineOrders', 'readonly');
      const store = tx.objectStore('OfflineOrders');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (orders.length === 0) return;

    for (let order of orders) {
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(order.payload)
        });
        
        const result = await response.json();
        
        if (result && result.status === 'success') {
          // Xóa đơn khi máy chủ xác nhận thành công
          await new Promise((resolve, reject) => {
            const tx = db.transaction('OfflineOrders', 'readwrite');
            const store = tx.objectStore('OfflineOrders');
            const req = store.delete(order.id);
            req.onsuccess = resolve;
            req.onerror = reject;
          });
        } else if (result && result.status === 'error') {
          const msg = result.message || '';
          // CÔNG TẮC AN TOÀN: Phát hiện Token hết hạn
          if (msg.includes('401') || msg.includes('hết hạn') || msg.includes('SESSION_EXPIRED')) {
            console.warn('[SW] CẢNH BÁO: Token hết hạn. Khóa luồng đồng bộ ngầm để bảo toàn đơn hàng.');
            break; // Lập tức đóng băng toàn bộ tiến trình
          }
        }
      } catch (e) {
        // Lỗi mạng hoặc Timeout: Dừng lại chờ đợt sóng sau
        break; 
      }
    }
  } catch (err) {
    console.error("[SW] Lỗi hệ thống cơ sở dữ liệu:", err);
  }
}
