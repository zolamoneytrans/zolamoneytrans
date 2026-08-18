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

// ── Smart Share (WhatsApp / Native) ──
window.shareZolaApp = function() {
  const shareData = {
    title: 'Zola Money Trans',
    text: 'Rejoignez-moi sur Zola, la meilleure application pour gérer votre argent !',
    url: 'https://zolamoneytransmarchand.web.app/'
  };

  if (navigator.share) {
    navigator.share(shareData)
      .then(() => showToast('Merci pour votre partage !', 'success'))
      .catch((err) => console.log('Partage annulé ou échoué:', err));
  } else {
    // Fallback WhatsApp
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareData.text + ' ' + shareData.url)}`;
    window.open(waUrl, '_blank');
  }
};

// ── KYC Reminder Modal / Feature ──
window.checkAndShowKycReminder = function(user) {
  if (!user) return;
  const isVerified = user.kycStatus === 'approuve' || user.verified === true;
  if (isVerified || user.kycStatus === 'soumis') return;
  if (sessionStorage.getItem('kycReminderDismissed')) return;
  if (document.getElementById('kycReminderModal')) return;

  const modal = document.createElement('div');
  modal.id = 'kycReminderModal';
  modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:999999; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(8px);';
  modal.innerHTML = `
    <div style="background:linear-gradient(145deg, #13131f, #1e1e30); border:1px solid rgba(245, 158, 11, 0.4); border-radius:24px; max-width:500px; width:100%; padding:30px; box-shadow:0 25px 50px rgba(0,0,0,0.6); position:relative; color:#fff; font-family:'Outfit',sans-serif;">
      <button onclick="document.getElementById('kycReminderModal').remove(); sessionStorage.setItem('kycReminderDismissed','true');" style="position:absolute; top:20px; right:20px; background:rgba(255,255,255,0.1); border:none; color:#fff; width:36px; height:36px; border-radius:50%; cursor:pointer; font-size:1.2rem; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">✕</button>
      
      <div style="width:60px; height:60px; border-radius:18px; background:rgba(245, 158, 11, 0.15); border:1px solid rgba(245, 158, 11, 0.3); display:flex; align-items:center; justify-content:center; font-size:2rem; margin-bottom:20px;">
        🛡️
      </div>
      
      <h2 style="font-size:1.5rem; font-weight:800; margin-bottom:10px; background:linear-gradient(90deg, #fff, #f6e05e); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Mettez à jour votre KYC</h2>
      <p style="color:#cbd5e1; font-size:0.95rem; line-height:1.5; margin-bottom:20px;">
        Votre compte est actuellement en statut basique. Complétez la vérification de votre identité (KYC) pour profiter de l'expérience Zola sans limites.
      </p>
      
      <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:18px; margin-bottom:24px;">
        <h4 style="font-size:0.9rem; font-weight:700; color:#F59E0B; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
          <span>✨</span> Pourquoi vérifier votre compte ?
        </h4>
        <div style="display:flex; flex-direction:column; gap:10px; font-size:0.85rem; color:#e2e8f0;">
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <span style="color:#10B981; font-weight:bold;">✓</span>
            <div><strong>Plafonds élevés :</strong> Effectuez vos dépôts, transferts et retraits avec des limites de transaction débloquées.</div>
          </div>
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <span style="color:#10B981; font-weight:bold;">✓</span>
            <div><strong>Accès complet :</strong> Débloquez les cartes virtuelles Visa et l'encaissement marchand instantané.</div>
          </div>
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <span style="color:#10B981; font-weight:bold;">✓</span>
            <div><strong>Procédure rapide :</strong> Pièce d'identité et selfie suffisent. <em>Le justificatif de domicile (facture) n'est pas obligatoire !</em></div>
          </div>
        </div>
      </div>
      
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <a href="kyc.html" class="btn btn-gold" style="flex:1; padding:14px; text-align:center; font-weight:700; border-radius:12px; text-decoration:none; display:block; background:linear-gradient(135deg, #F59E0B, #D97706); color:#fff;">
          Vérifier mon profil maintenant →
        </a>
        <button onclick="document.getElementById('kycReminderModal').remove(); sessionStorage.setItem('kycReminderDismissed','true');" style="background:rgba(255,255,255,0.08); border:none; color:#cbd5e1; padding:14px 20px; border-radius:12px; font-weight:600; cursor:pointer;">
          Plus tard
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};
