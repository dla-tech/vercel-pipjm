// /firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA0Yj_GIZqNzMaH5ChzWsSz_spORbHKMiY",
  authDomain: "miappiglesia.firebaseapp.com",
  projectId: "miappiglesia",
  storageBucket: "miappiglesia.firebasestorage.app",
  messagingSenderId: "624809525779",
  appId: "1:624809525779:web:2608aa1d23a84e466a35e6",
  measurementId: "G-8LLBP4ZB45"
});

const messaging = firebase.messaging();
