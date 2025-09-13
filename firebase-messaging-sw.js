// firebase-messaging-sw.js (en la RAÍZ del dominio)
importScripts('https://www.gstatic.com/firebasejs/9.6.11/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.11/firebase-messaging-compat.js');

// 🔁 Usa TU config web de Firebase (apiKey, authDomain, projectId, senderId, appId)
firebase.initializeApp({
  apiKey: "TU_API_KEY_WEB",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID",
});

// Inicializa FCM en el SW
const messaging = firebase.messaging();

// Notificaciones en segundo plano (cuando la app está cerrada)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Notificación";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icons/icon-192.png",   // opcional: ícono de tu PWA
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});
