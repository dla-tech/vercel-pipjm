// firebase-messaging-sw.js
// ==========================
// Service Worker exclusivo de Firebase Cloud Messaging (FCM)
// Maneja notificaciones cuando la PWA está cerrada o en segundo plano
// ==========================

// Importa los SDK de Firebase en modo compatibilidad
// (No uses el import normal porque los service workers no soportan ESModules directamente)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Configuración de Firebase (la misma que en tu index.html)
firebase.initializeApp({
  apiKey: "AIzaSyA0Yj_GIZqNzMaH5ChzWsSz_spORbHKMiY",
  authDomain: "miappiglesia.firebaseapp.com",
  projectId: "miappiglesia",
  storageBucket: "miappiglesia.firebasestorage.app",
  messagingSenderId: "624809525779",
  appId: "1:624809525779:web:2608aa1d23a84e466a35e6",
  measurementId: "G-8LLBP4ZB45"
});

// Inicializa Firebase Cloud Messaging
const messaging = firebase.messaging();

// Manejo de notificaciones cuando la PWA está en background o cerrada
messaging.onBackgroundMessage((payload) => {
  console.log('📩 Notificación recibida en background:', payload);

  const title = payload.notification?.title || "Notificación";
  const options = {
    body: payload.notification?.body || "",
    icon: "icons/icon-192.png",
    data: payload.data || {}
  };

  // Mostrar la notificación en la bandeja del sistema
  self.registration.showNotification(title, options);
});