if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          '/service-worker.js'
        );
  
        console.log(
          'Service Worker registered successfully:',
          registration.scope
        );
      } catch (error) {
        console.error(
          'Service Worker registration failed:',
          error
        );
      }
    });
  }