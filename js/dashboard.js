// js/dashboard.js — Tableau de bord Zola Money Trans (LIVE Firestore)
// Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDocs, Timestamp, getDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let chartInstance = null;

const statusBadge = s => {
  const map = { 'succès':'success', 'en_attente':'warning', 'échoué':'danger' };
  const labels = { 'succès':'Confirmé', 'en_attente':'En attente', 'échoué':'Échoué' };
  return `<span class="badge badge-${map[s]||'info'}">${labels[s]||s}</span>`;
};

const opColor = { 'mpesa':'#e31e24','airtel':'#FF0000','orange':'#FF6600','afrimoney':'#6D28D9','M-Pesa':'#e31e24','Airtel Money':'#FF0000','Orange Money':'#FF6600','Afrimoney':'#6D28D9' };

// ── Table des transactions ──
function renderTxTable(docs) {
  const tbody = document.getElementById('txTableBody');
  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:32px;">Aucune transaction pour l'instant.</td></tr>`;
    return;
  }
  tbody.innerHTML = docs.map((d, i) => {
    const tx = d.data ? d.data() : d;
    let dateVal = new Date();
    if (tx.createdAt?.toDate) {
      dateVal = tx.createdAt.toDate();
    } else if (tx.date) {
      dateVal = new Date(tx.date);
    }
    const op = tx.operateur || '—';
    const benef = tx.beneficiaire || tx.customerNumber || '—';
    return `
    <tr class="tx-item" style="animation-delay:${i*0.04}s">
      <td style="color:var(--c-text2);font-size:.82rem;">${new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(dateVal)}</td>
      <td><strong>${tx.type || tx.action || '—'}</strong></td>
      <td>${benef}</td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${opColor[op]||'#7C3AED'};"></span>${op.toUpperCase()}</span></td>
      <td style="font-family:'Outfit',sans-serif;font-weight:700;">${formatMoney(tx.montant, tx.currency || 'CDF')}</td>
      <td>${statusBadge(tx.statut)}</td>
    </tr>`;
  }).join('');
}

// ── Graphique ──
function buildChart(labels, vals) {
  const ctx = document.getElementById('txChart')?.getContext('2d');
  if (!ctx) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Transactions',
        data: vals,
        borderColor: '#7C3AED',
        backgroundColor: 'rgba(124,58,237,0.12)',
        tension: 0.4, fill: true,
        pointBackgroundColor: '#7C3AED',
        pointRadius: 5, pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#A89FC0' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#A89FC0', stepSize: 1 }, beginAtZero: true }
      }
    }
  });
}

// ── Chart basé sur Firestore (7 ou 30 jours) ──
async function loadChart(uid, days) {
  const since = new Date(); since.setDate(since.getDate() - days);
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    where('createdAt', '>=', Timestamp.fromDate(since)),
    orderBy('createdAt', 'asc')
  );
  const snap = await getDocs(q);
  const countByDay = {};
  snap.forEach(d => {
    const date = d.data().createdAt?.toDate?.() || new Date();
    const key  = date.toISOString().slice(0,10);
    countByDay[key] = (countByDay[key] || 0) + 1;
  });

  const labels = [], vals = [];
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    labels.push(new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric'}).format(d));
    vals.push(countByDay[key] || 0);
  }
  buildChart(labels, vals);
}

window.reloadChart = function(days) {
  if (window._dashUser) loadChart(window._dashUser, parseInt(days));
};

// ── Export CSV depuis Firestore ──
window.exportCSV = async function() {
  if (!window._dashUser) return;
  const q = query(collection(db,'transactions'), where('userId','==',window._dashUser), orderBy('createdAt','desc'), limit(500));
  const snap = await getDocs(q);
  const header = 'Date,Type,Bénéficiaire,Opérateur,Montant,Devise,Statut,Référence';
  const rows = snap.docs.map(d => {
    const tx = d.data();
    const date = tx.createdAt?.toDate?.()?.toLocaleDateString('fr-FR') || '—';
    return `${date},${tx.type||''},${tx.beneficiaire||tx.customerNumber||''},${tx.operateur||''},${tx.montant||0},${tx.currency||'CDF'},${tx.statut||''},${tx.reference||''}`;
  });
  const csv  = [header,...rows].join('\n');
  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download = `zola-transactions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Export CSV téléchargé !','success');
};

window.handleLogout = async () => { await signOut(auth); window.location.href = 'auth.html'; };

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }
  window._dashUser = user.uid;

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
  const un = document.getElementById('userName'); if (un) { un.textContent = user.displayName || user.email; un.parentElement.style.display='flex'; }
  const ue = document.getElementById('userEmail'); if (ue) ue.textContent = user.email;
  const dd = document.getElementById('dateDisplay'); if (dd) dd.textContent = new Intl.DateTimeFormat('fr-FR',{dateStyle:'full'}).format(new Date());

  // ── KYC badge depuis Firestore ──
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (userSnap.exists()) {
      const u = userSnap.data();
      if (u.blocked === true) {
        await signOut(auth);
        window.location.href = 'auth.html';
        return;
      }
      const uType = u.type || 'particulier';
      document.querySelectorAll('a[href="merchant.html"]').forEach(link => {
        link.style.display = (uType === 'marchand') ? 'flex' : 'none';
      });
      if (uType === 'marchand') { window.location.href = 'dashboard_marchand.html'; return; }
      if (uType === 'entreprise') { window.location.href = 'dashboard_entreprise.html'; return; }
      if (uType === 'eglise') { window.location.href = 'dashboard_eglise.html'; return; }

      const kycLevels = { basique:'badge-warning', avance:'badge-primary', marchand:'badge-success' };
      const kycLabels = { basique:'KYC Basique', avance:'KYC Avancé', marchand:'KYC Marchand' };
      const kl = u.kycLevel || 'basique';
      const kb = document.getElementById('kycBadge');
      if (kb) kb.innerHTML = `<span class="badge ${kycLevels[kl]||'badge-warning'}">${kycLabels[kl]||'KYC Basique'}</span>`;

      const kycTextEl = document.getElementById('kycStatusText');
      if (kycTextEl) {
        if (u.kycStatus === 'soumis') {
          kycTextEl.textContent = 'En examen (KYC)';
          kycTextEl.style.color = '#F59E0B';
        } else if (u.kycStatus === 'rejete') {
          kycTextEl.textContent = 'KYC Refusé';
          kycTextEl.style.color = '#EF4444';
        } else if (u.kycStatus === 'approuve' || kl !== 'basique') {
          kycTextEl.textContent = kycLabels[kl] || 'KYC Vérifié';
          kycTextEl.style.color = '#10B981';
        } else {
          kycTextEl.textContent = 'KYC Basique';
          kycTextEl.style.color = 'var(--c-text2)';
        }
      }

      if (window.checkAndShowKycReminder) window.checkAndShowKycReminder(u);

      // ── Onboarding Checklist Logic ──
      const hasInfoPin = !!(u.phone && u.pin);
      const hasPayout = !!(u.cardAttached || (u.autoSettlementEnabled && u.autoSettlementTarget));
      const hasKyc = kl !== 'basique';
      
      let completedSteps = 0;
      if (hasInfoPin) completedSteps++;
      if (hasPayout) completedSteps++;
      if (hasKyc) completedSteps++;
      
      const light = document.getElementById('accountStatusLight');
      const obWidget = document.getElementById('onboardingWidget');
      
      if (completedSteps < 3) {
        if (light) {
          light.style.backgroundColor = '#EF4444';
          light.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
          light.title = 'Compte non prêt pour les transactions';
        }
        if (obWidget) {
          obWidget.style.display = 'block';
          
          const progressPct = Math.round((completedSteps / 3) * 100);
          document.getElementById('obProgressText').textContent = `${progressPct}%`;
          setTimeout(() => {
            const pb = document.getElementById('obProgressBar');
            if(pb) pb.style.width = `${progressPct}%`;
          }, 300);
          
          const markCompleted = (stepId, iconId) => {
            const el = document.getElementById(stepId);
            const icon = document.getElementById(iconId);
            if (el && icon) {
              el.style.borderColor = 'rgba(16, 185, 129, 0.3)';
              el.style.background = 'rgba(16, 185, 129, 0.05)';
              icon.style.background = 'rgba(16, 185, 129, 0.2)';
              icon.style.color = '#10B981';
              icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            }
          };

          if (hasInfoPin) markCompleted('obStepInfo', 'obIconInfo');
          if (hasPayout) markCompleted('obStepPayout', 'obIconPayout');
          if (hasKyc) markCompleted('obStepKyc', 'obIconKyc');
        }
      } else {
        if (light) {
          light.style.backgroundColor = '#10B981';
          light.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.6)';
          light.title = 'Compte prêt pour les transactions';
        }
        if (obWidget) {
          obWidget.style.display = 'none';
        }
      }
    }
  } catch(e) { console.warn('[Dashboard] KYC badge:', e); }

  // ── Statistiques depuis Firestore ──
  const today = new Date(); today.setHours(0,0,0,0);
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); yesterday.setHours(0,0,0,0);

  // Transactions du jour (live)
  onSnapshot(
    query(collection(db,'transactions'), where('userId','==',user.uid), where('createdAt','>=',Timestamp.fromDate(today)), orderBy('createdAt','desc')),
    snap => {
      const el = document.getElementById('statTx');
      if (el) el.textContent = snap.size;
    }
  );

  // Volume mensuel (live)
  onSnapshot(
    query(collection(db,'transactions'), where('userId','==',user.uid), where('createdAt','>=',Timestamp.fromDate(thisMonth)), orderBy('createdAt','desc')),
    snap => {
      let volCDF = 0, revCDF = 0, volUSD = 0, revUSD = 0;
      snap.forEach(d => {
        const tx = d.data();
        const amt = tx.montant || 0;
        if (tx.currency === 'USD') {
          volUSD += amt; revUSD += amt * 0.018;
        } else {
          volCDF += amt; revCDF += amt * 0.018;
        }
      });
      const ev = document.getElementById('statVolume'); if (ev) ev.textContent = formatMoney(volCDF, 'CDF');
      const evU = document.getElementById('statVolumeUSD'); if (evU) evU.textContent = formatMoney(volUSD, 'USD');
      const er = document.getElementById('statRevenue'); if (er) er.textContent = formatMoney(Math.round(revCDF), 'CDF');
      const erU = document.getElementById('statRevenueUSD'); if (erU) erU.textContent = formatMoney(revUSD, 'USD');
    }
  );

  // Alertes AML
  const amlSnap = await getDocs(query(collection(db,'aml_alerts'), where('userId','==',user.uid), where('statut','==','En attente'), limit(1)));
  if (!amlSnap.empty) {
    const amlAlert = document.getElementById('amlAlert');
    if (amlAlert) {
      amlAlert.style.display = 'flex';
      const msg = document.getElementById('amlMessage');
      if (msg) msg.textContent = `Alerte AML active : ${amlSnap.size} transaction(s) en surveillance. Contactez le support.`;
    }
  }

  // ── Transactions récentes (live) ──
  onSnapshot(
    query(collection(db,'transactions'), where('userId','==',user.uid), orderBy('createdAt','desc'), limit(20)),
    snap => renderTxTable(snap.docs)
  );

  // ── Graphique 7 jours ──
  loadChart(user.uid, 7);
});
