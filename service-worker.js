self.addEventListener('install', e => {
    self.skipWaiting();
  });
  
  self.addEventListener('fetch', event => {
    // Puedes agregar caché si deseas
  });