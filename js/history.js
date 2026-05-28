import { auth, db } from './firebase.js';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let allTransactions = [];

const statusBadge = s => {
  const map = { 'succès':'success', 'en_attente':'warning', 'échoué':'danger' };
  const labels = { 'succès':'Confirmé', 'en_attente':'En attente', 'échoué':'Échoué' };
  return `<span class="badge badge-${map[s]||'info'}">${labels[s]||s}</span>`;
};

const opColor = { 'mpesa':'#e31e24','airtel':'#FF0000','orange':'#FF6600','afrimoney':'#6D28D9','M-Pesa':'#e31e24','Airtel Money':'#FF0000','Orange Money':'#FF6600','Afrimoney':'#6D28D9' };

window.formatMoney = function(amount, currency = 'CDF') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency }).format(amount);
};

function renderTxTable(txList) {
  const tbody = document.getElementById('txTableBody');
  if (!txList || txList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--c-text3);padding:32px;">Aucune transaction trouvée.</td></tr>`;
    return;
  }
  tbody.innerHTML = txList.map((tx, i) => {
    let dateVal = new Date();
    if (tx.createdAt?.toDate) {
      dateVal = tx.createdAt.toDate();
    } else if (tx.date) {
      dateVal = new Date(tx.date);
    }
    const op = tx.operateur || '—';
    const benef = tx.beneficiaire || tx.customerNumber || '—';
    return `
    <tr class="tx-item" style="animation-delay:${i > 20 ? 0 : i*0.02}s">
      <td style="color:var(--c-text2);font-size:.82rem;">${new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(dateVal)}</td>
      <td><strong>${tx.type || tx.action || '—'}</strong></td>
      <td>${benef}</td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${opColor[op]||'#7C3AED'};"></span>${op.toUpperCase()}</span></td>
      <td style="font-family:'Outfit',sans-serif;font-weight:700;color:${tx.action === 'credit' ? '#10B981' : 'var(--c-text)'}">
        ${tx.action === 'credit' ? '+' : ''}${window.formatMoney(tx.montant, tx.currency || 'CDF')}
      </td>
      <td>${statusBadge(tx.statut)}</td>
      <td style="font-size:0.75rem; color:var(--c-text3); font-family:monospace;">${tx.reference || tx.transactionId || '—'}</td>
    </tr>`;
  }).join('');
}

window.filterTransactions = function(val) {
  if (!val) {
    renderTxTable(allTransactions);
    return;
  }
  const lowVal = val.toLowerCase();
  const filtered = allTransactions.filter(tx => {
    const amountStr = String(tx.montant || '');
    const benefStr = String(tx.beneficiaire || tx.customerNumber || '').toLowerCase();
    const refStr = String(tx.reference || tx.transactionId || '').toLowerCase();
    const opStr = String(tx.operateur || '').toLowerCase();
    const typeStr = String(tx.type || tx.action || '').toLowerCase();
    
    return amountStr.includes(lowVal) || benefStr.includes(lowVal) || refStr.includes(lowVal) || opStr.includes(lowVal) || typeStr.includes(lowVal);
  });
  renderTxTable(filtered);
};

window.exportCSV = function() {
  if (allTransactions.length === 0) return;
  const header = 'Date,Type,Bénéficiaire,Opérateur,Montant,Devise,Statut,Référence';
  const rows = allTransactions.map(tx => {
    const date = tx.createdAt?.toDate?.()?.toLocaleString('fr-FR') || '—';
    return `${date},${tx.type||''},${tx.beneficiaire||tx.customerNumber||''},${tx.operateur||''},${tx.montant||0},${tx.currency||'CDF'},${tx.statut||''},${tx.reference||''}`;
  });
  const csv  = [header,...rows].join('\n');
  const a    = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download = `zola-historique-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  // If showToast is available from app.js
  if (window.showToast) window.showToast('Export CSV téléchargé !','success');
};

window.handleLogout = async () => { await signOut(auth); window.location.href = 'auth.html'; };

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
  const un = document.getElementById('userName'); if (un) { un.textContent = user.displayName || user.email; un.parentElement.style.display='flex'; }
  const ue = document.getElementById('userEmail'); if (ue) ue.textContent = user.email;
  const dd = document.getElementById('dateDisplay'); if (dd) dd.textContent = new Intl.DateTimeFormat('fr-FR',{dateStyle:'full'}).format(new Date());

  // Determine User Type for Navigation
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (userSnap.exists()) {
      const u = userSnap.data();
      const uType = u.type || 'particulier';
      
      const typeBadge = document.getElementById('userTypeBadge');
      if (typeBadge) typeBadge.textContent = uType;
      
      const navDashboard = document.getElementById('navDashboard');
      const mobileNavDashboard = document.getElementById('mobileNavDashboard');
      
      if (uType === 'marchand') { 
        if (navDashboard) navDashboard.href = 'dashboard_marchand.html'; 
        if (mobileNavDashboard) mobileNavDashboard.href = 'dashboard_marchand.html'; 
      } else if (uType === 'entreprise') { 
        if (navDashboard) navDashboard.href = 'dashboard_entreprise.html'; 
        if (mobileNavDashboard) mobileNavDashboard.href = 'dashboard_entreprise.html'; 
      }
    }
  } catch(e) { console.warn('[History] Error fetching user type:', e); }

  // Load Transactions
  try {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(1000)
    );
    const snap = await getDocs(q);
    allTransactions = [];
    snap.forEach(d => {
      allTransactions.push({ id: d.id, ...d.data() });
    });
    renderTxTable(allTransactions);
  } catch(err) {
    console.error('Erreur chargement historique:', err);
    document.getElementById('txTableBody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;padding:32px;">Erreur: ${err.message}</td></tr>`;
  }
});
