// js/app.js — Bootstrap, PWA, helpers globaux
// Zola Money Trans · Swazi Appli Lab SARL

// ── PWA Service Worker ──
let newWorker;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Enregistré:', reg.scope);
        
        reg.addEventListener('updatefound', () => {
          newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        });
      })
      .catch(err => console.warn('[SW] Erreur:', err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        window.location.reload();
        refreshing = true;
      }
    });
  });
}

function showUpdateNotification() {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast info`;
  t.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" style="width:24px;height:24px;flex-shrink:0;">
          <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
        <span style="font-weight:600; font-size: 0.9rem;">Mise à jour disponible !</span>
      </div>
      <button class="btn btn-primary btn-sm" id="btnUpdateApp" style="align-self:flex-end;">Mettre à jour</button>
    </div>
  `;
  container.appendChild(t);
  
  document.getElementById('btnUpdateApp').addEventListener('click', () => {
    if (newWorker) {
      newWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  });
}

// ── Toast notifications ──
window.showToast = function(msg, type = 'info') {
  const icons = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(60px)'; t.style.transition='0.3s ease'; setTimeout(()=>t.remove(),300); }, 3500);
};

// ── Sidebar toggle (mobile) ──
window.toggleSidebar = function() {
  const sb = document.querySelector('.sidebar');
  const ov = document.querySelector('.sidebar-overlay');
  if (sb) sb.classList.toggle('open');
  if (ov) ov.classList.toggle('open');
};

// ── Format helpers ──
window.fmtCDF = amt => new Intl.NumberFormat('fr-CD', { style:'currency', currency:'CDF', maximumFractionDigits:0 }).format(amt);
window.fmtUSD = amt => new Intl.NumberFormat('fr-FR', { style:'currency', currency:'USD', minimumFractionDigits:2 }).format(amt);
window.formatMoney = (amt, currency = 'CDF') => {
  if(currency === 'USD') return window.fmtUSD(amt);
  return window.fmtCDF(amt);
};
window.fmtDate = ts => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('fr-FR', { dateStyle:'short', timeStyle:'short' }).format(d);
};

// ── Active nav link ──
document.addEventListener('DOMContentLoaded', () => {
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('href') === path) el.classList.add('active');
  });
});
