let deferredPrompt = null;
let isInstalled = false;
let installAppBtn = null;
let installManualModal = null;
let closeInstallManual = null;
let gotItInstallBtn = null;
let previousFocus = null;
let previousOverflow = '';
let inertElements = [];

// Helper to check if running standalone
function checkStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Helper to detect iOS
function isIOS() {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform)
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

// Helper to detect macOS Safari
function isMacSafari() {
  return navigator.vendor && navigator.vendor.indexOf('Apple') > -1 &&
         navigator.userAgent && navigator.userAgent.indexOf('Mac') > -1 &&
         !navigator.userAgent.match('CriOS') && !navigator.userAgent.match('FxiOS') &&
         !("ontouchend" in document);
}

function updateInstallButton() {
  if (!installAppBtn) return;
  if (checkStandalone() || isInstalled) {
    installAppBtn.style.display = 'none';
  } else {
    installAppBtn.style.display = 'inline-flex';
    if (deferredPrompt) {
      installAppBtn.innerHTML = '⬇️ Download app';
    } else {
      installAppBtn.innerHTML = 'ℹ️ Download app';
    }
  }
}

// Listen for display mode changes
window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
  updateInstallButton();
});

// Handle native install prompt event
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallButton();
});

// Handle successful installation
window.addEventListener('appinstalled', () => {
  isInstalled = true;
  deferredPrompt = null;
  updateInstallButton();
  console.log('PWA was installed natively');
});

// Focus trapping
function handleKeydown(e) {
  if (installManualModal.style.display !== 'flex') return;

  if (e.key === 'Escape') {
    closeInstallModal();
    return;
  }

  if (e.key === 'Tab') {
    const focusable = installManualModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }
}

// Setup modal logic
function openInstallModal() {
  if (!installManualModal) return;
  previousFocus = document.activeElement;
  installManualModal.style.display = 'flex';

  // Save overflow and prevent background interaction
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Make background inert
  inertElements = [];
  Array.from(document.body.children).forEach(child => {
    if (
      child !== installManualModal &&
      child.tagName !== 'SCRIPT' &&
      child.tagName !== 'STYLE' &&
      child.tagName !== 'NOSCRIPT' &&
      child.tagName !== 'LINK'
    ) {
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        inertElements.push(child);
      }
    }
  });

  const desc = installManualModal.querySelector('p');
  if (desc) {
    if (isIOS()) {
      desc.innerHTML = 'To install this app on your iPhone/iPad, tap the <strong>Share</strong> icon in Safari and select <strong>Add to Home Screen</strong>. <em>(Website-triggered native installation is unavailable on iOS)</em>.';
    } else if (isMacSafari()) {
      desc.innerHTML = 'To install this app on macOS Safari, click <strong>File</strong> or the <strong>Share</strong> icon in the menu bar, then select <strong>Add to Dock</strong>.';
    } else {
      desc.innerHTML = 'To install this app, look for an <strong>Install</strong> or <strong>Add to Home Screen</strong> option in your browser menu.';
    }
  }

  if (closeInstallManual) closeInstallManual.focus();
  document.addEventListener('keydown', handleKeydown);
}

function closeInstallModal() {
  if (!installManualModal) return;
  installManualModal.style.display = 'none';

  document.body.style.overflow = previousOverflow;

  // Restore inert states
  inertElements.forEach(child => {
    child.removeAttribute('inert');
  });
  inertElements = [];

  document.removeEventListener('keydown', handleKeydown);

  // Restore focus safely
  if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  installAppBtn = document.getElementById('installAppBtn');
  installManualModal = document.getElementById('installManualModal');
  closeInstallManual = document.getElementById('closeInstallManual');
  gotItInstallBtn = document.getElementById('gotItInstallBtn');

  updateInstallButton();

  if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        installAppBtn.disabled = true;
        const promptEvent = deferredPrompt;
        deferredPrompt = null;

        try {
          await promptEvent.prompt();
          const { outcome } = await promptEvent.userChoice;
          if (outcome === 'accepted') {
            console.log('User accepted the install prompt');
          } else {
            console.log('User dismissed the install prompt');
            // If they dismissed, next time it acts as a manual fallback
            updateInstallButton();
          }
        } catch (err) {
          console.error('Failed to prompt for install:', err);
          updateInstallButton();
        } finally {
          installAppBtn.disabled = false;
        }
      } else {
        openInstallModal();
      }
    });
  }

  if (closeInstallManual) {
    closeInstallManual.addEventListener('click', closeInstallModal);
  }

  if (gotItInstallBtn) {
    gotItInstallBtn.addEventListener('click', closeInstallModal);
  }

  if (installManualModal) {
    installManualModal.addEventListener('click', (e) => {
      if (e.target === installManualModal) {
        closeInstallModal();
      }
    });
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        '/service-worker.js'
      );
      console.log('Service Worker registered successfully:', registration.scope);
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  });
}
