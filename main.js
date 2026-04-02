/*
 * SmartGhat — Main JavaScript
 * UI Interactions, Navbar, Code Tabs, Animations
 */

// ─────────────────────────────────────────────
// NAVBAR SCROLL BEHAVIOR
// ─────────────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// Active nav link highlighting
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(sec => {
    const top = sec.offsetTop - 80;
    if (window.scrollY >= top) current = sec.getAttribute('id');
  });
  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#${current}`) link.classList.add('active');
  });
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// ─────────────────────────────────────────────
// SCROLL REVEAL ANIMATIONS
// ─────────────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll(
  '.problem-card, .feature-card, .impact-card, .flow-step, .bom-item, .arch-node'
).forEach(el => {
  el.classList.add('reveal-on-scroll');
  revealObserver.observe(el);
});

// ─────────────────────────────────────────────
// CODE TABS
// ─────────────────────────────────────────────
function showCode(id) {
  document.querySelectorAll('.code-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`code-${id}`).classList.add('active');
  event.target.classList.add('active');
}

function copyCode(panelId) {
  const panel = document.getElementById(panelId);
  const code = panel.querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.textContent).then(() => {
    const btn = panel.querySelector('.copy-btn');
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    btn.style.color = '#00ff88';
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-copy"></i> Copy';
      btn.style.color = '';
    }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = code.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ─────────────────────────────────────────────
// PARTICLE BACKGROUND (Hero Section)
// ─────────────────────────────────────────────
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      width: ${Math.random() * 4 + 2}px;
      height: ${Math.random() * 4 + 2}px;
      animation-delay: ${Math.random() * 6}s;
      animation-duration: ${4 + Math.random() * 8}s;
    `;
    container.appendChild(p);
  }
}
createParticles();

// ─────────────────────────────────────────────
// IMPACT BAR ANIMATIONS
// ─────────────────────────────────────────────
const barObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.impact-fill').forEach(fill => {
        const targetWidth = fill.style.width;
        fill.style.width = '0%';
        setTimeout(() => {
          fill.style.transition = 'width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          fill.style.width = targetWidth;
        }, 300);
      });
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.impact-card').forEach(card => barObserver.observe(card));

// ─────────────────────────────────────────────
// COUNTER ANIMATIONS (Hero Stats)
// ─────────────────────────────────────────────
function animateCounter(el, target, prefix = '', suffix = '', duration = 1500) {
  let start = 0;
  const step = (timestamp) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = prefix + Math.floor(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = prefix + target + suffix;
  };
  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

// ─────────────────────────────────────────────
// PROBLEM CARD HOVER EFFECTS
// ─────────────────────────────────────────────
document.querySelectorAll('.problem-card').forEach(card => {
  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-8px) scale(1.02)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

// ─────────────────────────────────────────────
// FLOW STEPS SEQUENTIAL ANIMATION
// ─────────────────────────────────────────────
let flowActive = 0;
setInterval(() => {
  document.querySelectorAll('.flow-step').forEach((step, i) => {
    step.classList.toggle('flow-highlight', i === flowActive);
  });
  flowActive = (flowActive + 1) % document.querySelectorAll('.flow-step').length;
}, 1200);

// ─────────────────────────────────────────────
// CANVAS RESPONSIVE RESIZE
// ─────────────────────────────────────────────
// Canvas auto-scales via CSS width:100% height:auto - no JS needed
// Just ensure the wrapper doesn't overflow
function checkLayout() {
  const wrapper = document.querySelector('.road-canvas-wrap');
  if (!wrapper) return;
  const w = wrapper.clientWidth;
  if (w > 0 && canvas) {
    canvas.style.width  = '100%';
    canvas.style.height = 'auto';
  }
}
window.addEventListener('resize', checkLayout);
checkLayout();

// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS FOR SIMULATION
// ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ignore if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch(e.key) {
    case 'a': addVehicle('car',   'A'); break;
    case 'A': addVehicle('truck', 'A'); break;
    case 'b': addVehicle('car',   'B'); break;
    case 'B': addVehicle('truck', 'B'); break;
    case 'k': addVehicle('bike',  'A'); break;
    case 'K': addVehicle('bike',  'B'); break;
    case 'u': addVehicle('bus',   'A'); break;
    case 'U': addVehicle('bus',   'B'); break;
    case 'r': case 'R': resetSimulation(); break;
    case 'd': case 'D': autoDemo(); break;
  }
});

// Keyboard hints
const shortcuts = document.createElement('div');
shortcuts.className = 'keyboard-hints';
shortcuts.innerHTML = `
  <div class="kb-hint"><kbd>a</kbd> Car→A</div>
  <div class="kb-hint"><kbd>A</kbd> Truck→A</div>
  <div class="kb-hint"><kbd>b</kbd> Car→B</div>
  <div class="kb-hint"><kbd>B</kbd> Truck→B</div>
  <div class="kb-hint"><kbd>k/K</kbd> Bike→A/B</div>
  <div class="kb-hint"><kbd>u/U</kbd> Bus→A/B</div>
  <div class="kb-hint"><kbd>D</kbd> Auto Demo</div>
  <div class="kb-hint"><kbd>R</kbd> Reset</div>
`;
document.querySelector('.event-log-wrap')?.after(shortcuts);

// ─────────────────────────────────────────────
// LoRa Packet Animation (Architecture Section)
// ─────────────────────────────────────────────
// Comm packets animated via CSS, no extra JS needed

// ─────────────────────────────────────────────
// SCROLL INDICATOR HIDE ON SCROLL
// ─────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const indicator = document.querySelector('.scroll-indicator');
  if (indicator) {
    indicator.style.opacity = window.scrollY > 100 ? '0' : '1';
  }
}, { passive: true });

console.log('%c SmartGhat Road Safety System v2.0 ', 
  'background:#0f2d1a;color:#00ff88;font-size:14px;font-weight:bold;padding:6px 12px;border-radius:4px;');
console.log('%c Convergence 2026 | HT202603 ', 
  'background:#1a0a3a;color:#a080ff;font-size:12px;padding:4px 8px');
