const CACHE_NAME = 'myle-pos-cache-v2';
const API_URL = "https://script.google.com/macros/s/AKfycbxz7SzvgAEcbWjl2qng1VlP9xG29VDyJmLCtOXzUHKs9zpqbH490G98kkBg2LdPhQv1Ug/exec";

// Cài đặt Service Worker
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Cache tài nguyên cơ bản (PWA Shell)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes(API_URL)) return;
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

// Hàm kết nối thẳng với IndexedDB từ Service Worker
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MyLePOS_DB', 2);
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

// Hàm đẩy dữ liệu ngầm lên Google Apps Script
async function syncOfflineOrders() {
  try {
    const db = await openDatabase();
    
    // Lấy toàn bộ đơn hàng bị kẹt
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
        // Gửi POST request sử dụng payload đã đóng gói sẵn apiKey từ lúc rớt mạng
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order.payload)
        });
        
        const result = await response.json();
        
        // Chỉ xóa khi Google Apps Script trả về trạng thái "success"
        if (result && result.status === "success") {
          await new Promise((resolve, reject) => {
            const tx = db.transaction('OfflineOrders', 'readwrite');
            const store = tx.objectStore('OfflineOrders');
            const req = store.delete(order.id);
            req.onsuccess = resolve;
            req.onerror = reject;
          });
        }
      } catch (e) {
        // Vẫn bị lỗi mạng (chưa ổn định), dừng lại để chờ lần kích hoạt Background Sync tiếp theo
        console.error("Lỗi đồng bộ ngầm: ", e);
        break; 
      }
    }
  } catch (err) {
    console.error("Lỗi mở IndexedDB từ SW:", err);
  }
}
