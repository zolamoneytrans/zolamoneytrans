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

const opColor = { 'mpesa':'#e31e24','airtel':'#FF0000','orange':'#FF6600','M-Pesa':'#e31e24','Airtel Money':'#FF0000','Orange Money':'#FF6600' };

// ── Table des transactions ──
function renderTxTable(docs) {
  const tbody = document.getElementById('txTableBody');
  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:32px;">Aucune transaction pour l'instant.</td></tr>`;
    return;
  }
  tbody.innerHTML = docs.map((d, i) => {
    const tx = d.data ? d.data() : d;
    const dateVal = tx.createdAt?.toDate ? tx.createdAt.toDate() : (tx.date || new Date());
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
      const uType = u.type || 'particulier';
      if (uType === 'particulier') { window.location.href = 'dashboard.html'; return; }
      if (uType === 'entreprise') { window.location.href = 'dashboard_entreprise.html'; return; }

      const kycLevels = { basique:'badge-warning', avance:'badge-primary', marchand:'badge-success' };
      const kycLabels = { basique:'KYC Basique', avance:'KYC Avancé', marchand:'KYC Marchand' };
      const kl = u.kycLevel || 'basique';
      const kb = document.getElementById('kycBadge');
      if (kb) kb.innerHTML = `<span class="badge ${kycLevels[kl]||'badge-warning'}">${kycLabels[kl]||'KYC Basique'}</span>`;
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
