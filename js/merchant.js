// js/merchant.js — Paiement Marchand LIVE via FreshPay (PayDRC)
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const functions  = getFunctions();
const payInFn    = httpsCallable(functions, 'payIn');
const checkStatusFn = httpsCallable(functions, 'checkStatus');

let currentUser = null;
let selectedOp  = 'M-Pesa';
let dynQRTimer  = null;

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const u = userSnap.data();
    const uType = u.type || 'particulier';
    if (!userSnap.exists() || uType !== 'marchand') {
      alert('Accès refusé. Cette page est réservée aux comptes marchands.');
      window.location.href = 'dashboard.html';
      return;
    }
  } catch (e) {
    console.error("Error fetching user profile", e);
    window.location.href = 'dashboard.html';
    return;
  }

  currentUser = user;
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
  document.getElementById('appShell').style.display = '';
  document.getElementById('loadingScreen').style.display = 'none';
  generateStaticQR(user);
  loadTodayTransactions(user.uid);
});

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

// ── QR Code statique ──
function generateStaticQR(user) {
  const payLink = `${location.origin}/pay.html?to=${user.uid}`;
  document.getElementById('payLink').textContent = payLink;
  const box = document.getElementById('staticQR');
  box.innerHTML = '';
  new QRCode(box, { text: payLink, width: 200, height: 200, colorDark: '#7C3AED', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
}

window.downloadQR = function(id, name) {
  const canvas = document.getElementById(id)?.querySelector('canvas');
  if (!canvas) { showToast('Générez d\'abord le QR code', 'error'); return; }
  const a = document.createElement('a');
  a.download = name + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
};

window.shareLink = async function() {
  const link = document.getElementById('payLink')?.textContent;
  if (!link) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Paiement Zola Money', url: link });
    } else {
      await navigator.clipboard.writeText(link);
      showToast('Lien copié dans le presse-papiers', 'success');
    }
  } catch(e) { showToast('Erreur de partage', 'error'); }
};

// ── QR Code dynamique ──
window.generateDynamicQR = function() {
  const amount   = parseFloat(document.getElementById('dynAmount').value) || 0;
  const currency = document.getElementById('dynCurrency').value;
  const desc     = document.getElementById('dynDesc').value.trim();
  const validity = parseInt(document.getElementById('dynValidity').value) || 30;

  const minAmt = currency === 'USD' ? 1 : 240;
  if (!amount || amount < minAmt) { showToast(`Montant minimum : ${minAmt} ${currency}`, 'error'); return; }

  const uid      = currentUser?.uid;
  const expiresAt = Date.now() + validity * 60000;
  const qrData   = JSON.stringify({ to: uid, amount, currency, desc, exp: expiresAt });

  const box = document.getElementById('dynamicQR');
  box.innerHTML = '';
  new QRCode(box, { text: qrData, width: 200, height: 200, colorDark: '#7C3AED', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  document.getElementById('dynQRWrap').style.display = '';

  // Compte à rebours
  if (dynQRTimer) clearInterval(dynQRTimer);
  dynQRTimer = setInterval(() => {
    const rem = Math.max(0, expiresAt - Date.now());
    const m = String(Math.floor(rem/60000)).padStart(2,'0');
    const s = String(Math.floor((rem%60000)/1000)).padStart(2,'0');
    document.getElementById('dynTimer').textContent = `⏱ ${m}:${s} restant`;
    if (rem === 0) { clearInterval(dynQRTimer); document.getElementById('dynQRWrap').style.display = 'none'; showToast('QR Code expiré', 'info'); }
  }, 1000);
};

// ── Sélection opérateur ──
window.selectOp = function(btn, op) {
  document.querySelectorAll('.operator-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedOp = op;
};

// ── Recevoir paiement LIVE via FreshPay PayIn ──
window.simulatePayment = async function() {
  const amount = parseFloat(document.getElementById('simAmount').value) || 0;
  const currency = document.getElementById('simCurrency').value;

  const minAmt = currency === 'USD' ? 1 : 240;
  if (!amount || amount < minAmt) { showToast(`Montant minimum : ${minAmt} ${currency}`, 'error'); return; }
  if (!currentUser) { showToast('Vous devez être connecté', 'error'); return; }

  // Demander numéro de téléphone du payeur
  const payerPhone = prompt('📱 Numéro du client payeur (ex: 0978123456) :');
  if (!payerPhone) return;

  const btn = document.querySelector('.btn-success');
  btn.disabled = true; btn.textContent = '⏳ Envoi de la demande…';

  try {
    const reference = 'MERCH-' + Date.now() + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
    const result = await payInFn({
      amount: String(amount),
      currency: currency,
      customerNumber: payerPhone.replace(/[\s\-\+]/g, ''),
      method: selectedOp,
      reference,
      description: 'Paiement marchand Zola Money',
      txType: 'Paiement QR'
    });

    const { transactionId, firestoreId } = result.data;
    showToast(`📲 Demande envoyée ! Le client va recevoir une notification ${selectedOp} pour confirmer.`, 'info');

    // Polling du statut
    pollMerchantStatus(reference, firestoreId);

  } catch(err) {
    console.error('[Merchant] Erreur:', err);
    showToast(err.message || 'Erreur lors de la demande de paiement.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Demander paiement';
  }
};

async function pollMerchantStatus(reference, firestoreId, attempts = 0) {
  if (attempts >= 12) {
    showToast('En attente de confirmation opérateur... Vérifiez l\'historique.', 'info');
    return;
  }
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await checkStatusFn({ reference, firestoreId });
    const { statut } = res.data;
    if (statut === 'succès') {
      showToast('✅ Paiement reçu et confirmé !', 'success');
    } else if (statut === 'échoué') {
      showToast('❌ Paiement refusé par l\'opérateur.', 'error');
    } else {
      pollMerchantStatus(reference, firestoreId, attempts + 1);
    }
  } catch(e) {
    pollMerchantStatus(reference, firestoreId, attempts + 1);
  }
}

// ── Transactions du jour depuis Firestore ──
function loadTodayTransactions(uid) {
  const startOfDay = Timestamp.fromDate(new Date(new Date().setHours(0,0,0,0)));
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    where('action', '==', 'debit'),
    where('createdAt', '>=', startOfDay),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  onSnapshot(q, snap => {
    const list = document.getElementById('todayTxList');
    const countBadge = document.getElementById('todayCount');
    countBadge.textContent = snap.size + ' transaction' + (snap.size !== 1 ? 's' : '');

    if (snap.empty) {
      list.innerHTML = '<p style="text-align:center;color:var(--c-text3);padding:24px;font-size:.88rem;">Aucune transaction aujourd\'hui.</p>';
      return;
    }

    const badges = { 'succès':'badge-success', 'échoué':'badge-error', 'en_attente':'badge-warning' };
    const labels = { 'succès':'Reçu', 'échoué':'Échoué', 'en_attente':'En attente' };
    list.innerHTML = snap.docs.map(d => {
      const tx = d.data();
      const op = (tx.operateur || '').toUpperCase();
      const colors = { 'M-PESA':'#e31e24', 'AIRTEL':'#FF0000', 'ORANGE':'#FF6600', 'AFRIMONEY':'#6D28D9', 'MPESA':'#e31e24', 'AIRTEL MONEY':'#FF0000', 'ORANGE MONEY':'#FF6600' };
      return `
      <div class="tx-item">
        <div class="tx-icon" style="background:${colors[op] || '#7C3AED'};font-weight:700;font-size:.7rem;">${op.slice(0,1)}</div>
        <div class="tx-info">
          <div class="tx-title">${tx.customerNumber || '—'}</div>
          <div class="tx-sub">${op} · ${fmtDate(tx.createdAt)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tx-amount credit">+${window.formatMoney(tx.montant, tx.currency || 'CDF')}</div>
          <span class="badge ${badges[tx.statut] || 'badge-warning'}" style="font-size:.7rem;">${labels[tx.statut] || tx.statut}</span>
        </div>
      </div>`;
    }).join('');
  });
}
