/* =========================================================
   LendLocal — effects engine
   Self-contained. Safe to include on every page.
   Exposes window.FX with helper methods used by dashboard.js
   and group.js for celebratory / feedback moments.
   ========================================================= */

   (function () {
    const REDUCE_MOTION =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
    /* ---------------------------------------------------
       1. Ambient particle canvas
       --------------------------------------------------- */
    function initParticles() {
      if (REDUCE_MOTION) return;
  
      const canvas = document.createElement('canvas');
      canvas.id = 'particle-canvas';
      document.body.prepend(canvas);
      const ctx = canvas.getContext('2d');
  
      let w, h, particles;
  
      function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
      }
  
      function makeParticles() {
        const count = Math.min(60, Math.floor((w * h) / 22000));
        particles = Array.from({ length: count }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 2.2 + 0.6,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          hue: Math.random() > 0.5 ? '15, 92, 76' : '212, 160, 23',
          alpha: Math.random() * 0.4 + 0.15,
        }));
      }
  
      function tick() {
        ctx.clearRect(0, 0, w, h);
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = w;
          if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h;
          if (p.y > h) p.y = 0;
  
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.hue}, ${p.alpha})`;
          ctx.fill();
        });
  
        // connect nearby particles with faint lines
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const a = particles[i];
            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 110) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = `rgba(15, 92, 76, ${0.08 * (1 - dist / 110)})`;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
  
        requestAnimationFrame(tick);
      }
  
      resize();
      makeParticles();
      tick();
      window.addEventListener('resize', () => {
        resize();
        makeParticles();
      });
    }
  
    /* ---------------------------------------------------
       2. Cursor glow trail (pointer devices only)
       --------------------------------------------------- */
    function initCursorGlow() {
      if (REDUCE_MOTION) return;
      if (!window.matchMedia('(pointer: fine)').matches) return;
  
      const glow = document.createElement('div');
      glow.id = 'cursor-glow';
      document.body.appendChild(glow);
  
      let raf = null;
      document.addEventListener('mousemove', (e) => {
        glow.classList.add('active');
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
        });
      });
  
      document.addEventListener('mouseleave', () => {
        glow.classList.remove('active');
      });
    }
  
    /* ---------------------------------------------------
       3. Button ripple + magnetic press
       --------------------------------------------------- */
    function initRipples() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn, .tab, .pay-btn');
        if (!btn) return;
  
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height) * 1.4;
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  
        const prevPosition = getComputedStyle(btn).position;
        if (prevPosition === 'static') btn.style.position = 'relative';
  
        btn.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
      });
    }
  
    /* ---------------------------------------------------
       4. Staggered reveal for lists (via IntersectionObserver
          + also just runs immediately for above-fold content)
       --------------------------------------------------- */
    function staggerReveal(container, selector, delayStep = 60) {
      if (!container) return;
      const items = container.querySelectorAll(selector);
      items.forEach((el, i) => {
        el.classList.add('reveal-stagger');
        setTimeout(() => {
          el.classList.add('in');
        }, i * delayStep + 30);
      });
    }
  
    /* ---------------------------------------------------
       5. Animated number counter
       --------------------------------------------------- */
    function animateNumber(el, endValue, { prefix = '', duration = 700, decimals = 2 } = {}) {
      if (!el) return;
      if (REDUCE_MOTION) {
        el.textContent = `${prefix}${endValue.toLocaleString('en-IN', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
        return;
      }
  
      const startValue = 0;
      const startTime = performance.now();
      el.classList.add('counting');
  
      function frame(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (endValue - startValue) * eased;
  
        el.textContent = `${prefix}${current.toLocaleString('en-IN', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
  
        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          el.classList.remove('counting');
        }
      }
  
      requestAnimationFrame(frame);
    }
  
    /* ---------------------------------------------------
       6. Confetti burst
       --------------------------------------------------- */
    function confettiBurst(originEl) {
      if (REDUCE_MOTION) return;
  
      const colors = ['#0f5c4c', '#d4a017', '#0f7a5f', '#f4faf7', '#c23b22'];
      const originRect = originEl
        ? originEl.getBoundingClientRect()
        : { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0 };
  
      const originX = originRect.left + originRect.width / 2;
  
      for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const size = Math.random() * 8 + 5;
        piece.style.width = `${size}px`;
        piece.style.height = `${size * (Math.random() > 0.5 ? 1 : 2.2)}px`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.left = `${originX + (Math.random() - 0.5) * 260}px`;
        piece.style.top = `${originRect.top - 10}px`;
  
        const fallDuration = Math.random() * 1.4 + 1.6;
        piece.style.animationDuration = `${fallDuration}s`;
        piece.style.opacity = String(Math.random() * 0.5 + 0.5);
  
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), fallDuration * 1000 + 100);
      }
    }
  
    /* ---------------------------------------------------
       7. Shake element (errors)
       --------------------------------------------------- */
    function shake(el) {
      if (!el) return;
      el.classList.remove('shake');
      // force reflow so the animation can re-trigger
      void el.offsetWidth;
      el.classList.add('shake');
    }
  
    /* ---------------------------------------------------
       8. Toast
       --------------------------------------------------- */
    function toast(message, duration = 2200) {
      let el = document.getElementById('fx-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'fx-toast';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(el._timer);
      el._timer = setTimeout(() => el.classList.remove('show'), duration);
    }
  
    /* ---------------------------------------------------
       9. Collapse-and-remove animation for a list item
       --------------------------------------------------- */
    function removeWithAnimation(el, callback) {
      if (!el) {
        if (callback) callback();
        return;
      }
      if (REDUCE_MOTION) {
        el.remove();
        if (callback) callback();
        return;
      }
      el.classList.add('fx-removing');
      el.addEventListener(
        'animationend',
        () => {
          el.remove();
          if (callback) callback();
        },
        { once: true }
      );
    }
  
    window.FX = {
      initParticles,
      initCursorGlow,
      initRipples,
      staggerReveal,
      animateNumber,
      confettiBurst,
      shake,
      toast,
      removeWithAnimation,
    };
  
    document.addEventListener('DOMContentLoaded', () => {
    //   initParticles();
    //   initCursorGlow();
      initRipples();
    });
  })();
  