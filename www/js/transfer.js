// js/transfer.js — Transferts Inter-Opérateurs LIVE via FreshPay (PayDRC)
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const functions = getFunctions();
const payOutFn    = httpsCallable(functions, 'payOut');
const payInFn     = httpsCallable(functions, 'payIn');
const checkStatus = httpsCallable(functions, 'checkStatus');

// ── Frais par corridor ──
const FEES = {
  'mpesa-airtel': .018, 'mpesa-orange': .020, 'mpesa-rawbank': .025, 'mpesa-equity': .025,
  'airtel-mpesa': .018, 'airtel-orange': .020, 'airtel-rawbank': .025, 'airtel-equity': .025,
  'orange-mpesa': .020, 'orange-airtel': .020, 'orange-rawbank': .025, 'orange-equity': .025,
  'default': .022
};

let pendingTransfer = null;
let currentUser     = null;
let userProfile     = null;
let userDocRef      = null;

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  userDocRef = doc(db, 'users', user.uid);
  onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      userProfile = snap.data();
      updateVisaCardUI();
      populateSourceOptions();
      
      const uType = userProfile.type || 'particulier';
      document.querySelectorAll('a[href="merchant.html"]').forEach(link => {
        link.style.display = (uType === 'marchand') ? 'flex' : 'none';
      });
    }
  });

  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
  document.getElementById('appShell').style.display = '';
  document.getElementById('loadingScreen').style.display = 'none';
  loadHistory();
});

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

// ── Gestion Visa & Sources de paiement ──
function populateSourceOptions() {
  const srcOp = document.getElementById('srcOp');
  if (!srcOp) return;
  const currentValue = srcOp.value;
  
  srcOp.innerHTML = '';
  const phone = userProfile && userProfile.phone ? userProfile.phone : '';
  
  if (phone) {
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('243')) clean = '0' + clean.substring(3);
    const prefix = clean.length >= 3 ? clean.substring(0, 3) : '';
    
    let operatorDetected = false;
    if (['081', '082', '083'].includes(prefix)) {
      srcOp.add(new Option(`M-Pesa (${phone})`, 'mpesa'));
      operatorDetected = true;
    } else if (['099', '097'].includes(prefix)) {
      srcOp.add(new Option(`Airtel Money (${phone})`, 'airtel'));
      operatorDetected = true;
    } else if (['084', '085', '089', '080'].includes(prefix)) {
      srcOp.add(new Option(`Orange Money (${phone})`, 'orange'));
      operatorDetected = true;
    }
    
    if (!operatorDetected) {
      srcOp.add(new Option(`M-Pesa (${phone})`, 'mpesa'));
      srcOp.add(new Option(`Airtel Money (${phone})`, 'airtel'));
      srcOp.add(new Option(`Orange Money (${phone})`, 'orange'));
    }
  } else {
    srcOp.add(new Option(`M-Pesa (Vodacom)`, 'mpesa'));
    srcOp.add(new Option(`Airtel Money`, 'airtel'));
    srcOp.add(new Option(`Orange Money`, 'orange'));
  }
  
  if (userProfile && userProfile.cardAttached) {
    const last4 = userProfile.cardLast4 || '****';
    srcOp.add(new Option(`Ma Banque (Visa *${last4})`, 'visa'));
  } else {
    srcOp.add(new Option(`Ma Banque (Ajouter Carte Visa)`, 'visa'));
  }
  
  if (['mpesa', 'airtel', 'orange', 'visa'].includes(currentValue)) {
    srcOp.value = currentValue;
  }
}

function updateVisaCardUI() {
  const savedVisaCardInfo = document.getElementById('savedVisaCardInfo');
  const savedCardMasked = document.getElementById('savedCardMasked');
  const manualVisaFields = document.getElementById('manualVisaFields');
  const useSavedVisa = document.getElementById('useSavedVisa');

  if (userProfile && userProfile.cardAttached) {
    if (savedCardMasked) {
      savedCardMasked.textContent = `•••• •••• •••• ${userProfile.cardLast4 || '0000'}`;
    }
    if (savedVisaCardInfo) {
      savedVisaCardInfo.style.display = 'block';
    }
    if (useSavedVisa && useSavedVisa.checked) {
      if (manualVisaFields) manualVisaFields.style.display = 'none';
    } else {
      if (manualVisaFields) manualVisaFields.style.display = 'block';
    }
  } else {
    if (savedVisaCardInfo) savedVisaCardInfo.style.display = 'none';
    if (manualVisaFields) manualVisaFields.style.display = 'block';
  }
}

window.toggleVisaInputFields = function() {
  const useSavedVisa = document.getElementById('useSavedVisa');
  const manualVisaFields = document.getElementById('manualVisaFields');
  if (useSavedVisa && useSavedVisa.checked) {
    if (manualVisaFields) manualVisaFields.style.display = 'none';
  } else {
    if (manualVisaFields) manualVisaFields.style.display = 'block';
  }
};

window.handleSourceChange = function() {
  const src = document.getElementById('srcOp').value;
  const visaFormContainer = document.getElementById('visaFormContainer');
  if (src === 'visa') {
    if (visaFormContainer) visaFormContainer.style.display = 'block';
    updateVisaCardUI();
  } else {
    if (visaFormContainer) visaFormContainer.style.display = 'none';
  }
};

// validateVisa supprimé (Cybersource Hosted Checkout)

// ── Calcul des frais ──
window.calcFees = function() {
  const amount = parseFloat(document.getElementById('txAmount').value) || 0;
  const currency = document.getElementById('txCurrency').value;
  const src = document.getElementById('srcOp').value;
  const dst = document.getElementById('dstOp').value;
  const feeSummary = document.getElementById('feeSummary');

  const minAmt = currency === 'USD' ? 1 : 240;
  if (!amount || amount < minAmt) { feeSummary.style.display = 'none'; return; }

  const rate = FEES[`${src}-${dst}`] || FEES['default'];
  const frais = currency === 'USD' ? parseFloat((amount * rate).toFixed(2)) : Math.round(amount * rate);
  const total = currency === 'USD' ? parseFloat((amount + frais).toFixed(2)) : amount + frais;

  document.getElementById('feeMontant').textContent = window.formatMoney(amount, currency);
  document.getElementById('feeMontantFrais').textContent = window.formatMoney(frais, currency) + ` (${(rate*100).toFixed(1)}%)`;
  document.getElementById('feeTotal').textContent = window.formatMoney(total, currency);
  feeSummary.style.display = '';
};

// Formatage Visa supprimé (Cybersource Hosted Checkout)

// ── Initier le transfert → demander PIN ──
window.initTransfer = async function(e) {
  e.preventDefault();
  const amount    = parseFloat(document.getElementById('txAmount').value);
  const currency  = document.getElementById('txCurrency').value;
  const src       = document.getElementById('srcOp').value;
  const dst       = document.getElementById('dstOp').value;
  const phone     = document.getElementById('benefPhone').value.trim();
  const name      = document.getElementById('benefName').value.trim();

  const minAmt = currency === 'USD' ? 1 : 240;
  if (!amount || amount < minAmt)  { showToast(`Montant minimum : ${minAmt} ${currency}`, 'error'); return; }
  if (!phone)                   { showToast('Numéro du bénéficiaire requis', 'error'); return; }

  const rate  = FEES[`${src}-${dst}`] || FEES['default'];
  const frais = currency === 'USD' ? parseFloat((amount * rate).toFixed(2)) : Math.round(amount * rate);
  const total = currency === 'USD' ? parseFloat((amount + frais).toFixed(2)) : amount + frais;

  pendingTransfer = { amount, currency, src, dst, phone, name, frais, total };

  // Afficher modal confirmation
  document.getElementById('confirmBody').innerHTML = `
    <div style="background:var(--c-surface2);border-radius:10px;padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Opérateur débit</span><strong>${src.toUpperCase()}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Opérateur crédit</span><strong>${dst.toUpperCase()}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Bénéficiaire</span><strong>${name || phone}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Numéro</span><strong>${phone}</strong>
      </div>
      <div style="height:1px;background:var(--c-border);margin:10px 0;"></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Montant</span><span>${window.formatMoney(amount, currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.88rem;">
        <span style="color:var(--c-text2)">Frais</span><span style="color:var(--c-gold)">${window.formatMoney(frais, currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:700;">
        <span>Total débité</span><span style="color:var(--c-primary-light)">${window.formatMoney(pendingTransfer.total, currency)}</span>
      </div>
    </div>`;
  document.getElementById('confirmModal').classList.add('open');
};

window.closeModal = () => document.getElementById('confirmModal').classList.remove('open');

// ── Demander le PIN puis exécuter ──
window.executeTransfer = async function() {
  closeModal();
  // Afficher PIN modal
  showPinModal('Entrez votre PIN de sécurité pour confirmer le transfert', async (pin) => {
    if (!pin || pin.length < 4) { showToast('PIN incorrect', 'error'); return; }
    await _doTransfer();
  });
};

async function _doTransfer() {
  const btn = document.getElementById('txBtn');
  const sp  = document.getElementById('txSpinner');
  const txt = document.getElementById('txBtnTxt');
  btn.disabled = true; sp.style.display = ''; txt.textContent = 'Traitement en cours…';

  try {
    const ref = 'ZOL-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
    
    let firestoreId;
    try {
      // Nous appelons payInFn (Débit de la source) avec le type "transfert"
      // Le webhook s'occupera du payOut (Crédit) plus tard en cas de succès
      const result = await payInFn({
        amount:          String(pendingTransfer.total), // On débite le total (montant + frais)
        currency:        pendingTransfer.currency,
        customerNumber:  userProfile?.phone || pendingTransfer.phone, // Numéro à débiter (le client)
        method:          pendingTransfer.src, // Opérateur de débit (ex: mpesa ou visa)
        reference:       ref,
        description:     `Transfert vers ${pendingTransfer.phone}`,
        isTransfer:      true,
        transferDest:    pendingTransfer.dst,
        transferBenef:   pendingTransfer.phone.replace(/[\s\-\+]/g, ''),
        transferAmount:  String(pendingTransfer.amount) // Montant net à créditer
      });

      const { transactionId, firestoreId: fid, links } = result.data;
      firestoreId = fid;
      
      if (links) {
        // Redirection vers Cybersource pour Visa
        showToast('Redirection vers le portail sécurisé Visa...', 'info');
        window.location.href = links;
        return; // Stoppe l'exécution ici, l'utilisateur quitte la page
      }

      showToast('Débit initié ! En attente de confirmation opérateur...', 'info');
      pollStatus(ref, firestoreId);
    } catch (err) {
      console.error('[Transfer] Cloud Function a échoué.', err);
      throw err; // Laisse le bloc catch extérieur gérer l'erreur
    }

    // Reset form
    document.getElementById('txAmount').value = '';
    document.getElementById('benefPhone').value = '';
    document.getElementById('benefName').value = '';
    document.getElementById('feeSummary').style.display = 'none';
    pendingTransfer = null;

  } catch(err) {
    console.error('[Transfer] Erreur:', err);
    showToast(err.message || 'Erreur lors du transfert. Réessayez.', 'error');
  } finally {
    btn.disabled = false; sp.style.display = 'none'; txt.textContent = 'Confirmer le transfert';
  }
}

// ── Polling du statut (max 10 tentatives) ──
async function pollStatus(reference, firestoreId, attempts = 0) {
  if (attempts >= 10) {
    showToast('Délai dépassé. Vérifiez l\'historique pour le statut final.', 'info');
    return;
  }
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await checkStatus({ reference, firestoreId });
    const { statut, transStatus } = res.data;
    if (statut === 'succès') {
      showToast('✅ Transfert confirmé avec succès !', 'success');
    } else if (statut === 'échoué') {
      showToast('❌ Transfert échoué. Veuillez réessayer ou contacter le support.', 'error');
    } else {
      pollStatus(reference, firestoreId, attempts + 1);
    }
  } catch(e) {
    pollStatus(reference, firestoreId, attempts + 1);
  }
}

// ── Historique depuis Firestore ──
function loadHistory() {
  if (!currentUser) return;
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', currentUser.uid),
    where('action', '==', 'credit'),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  onSnapshot(q, snap => {
    const list = document.getElementById('histList');
    const count = document.getElementById('histCount');
    if (snap.empty) {
      list.innerHTML = '<p style="text-align:center;color:var(--c-text3);padding:32px;font-size:.88rem;">Aucun transfert effectué.</p>';
      count.textContent = '0'; return;
    }
    count.textContent = snap.size;
    list.innerHTML = snap.docs.map(d => {
      const tx = d.data();
      const badges = { 'succès':'badge-success', 'échoué':'badge-error', 'en_attente':'badge-warning' };
      const labels = { 'succès':'Confirmé', 'échoué':'Échoué', 'en_attente':'En attente' };
      return `
      <div class="tx-item">
        <div class="tx-icon" style="background:var(--c-primary);"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 16 4-4-4-4"/><path d="m11 20 4-4-4-4"/><path d="M3 12h18"/></svg></div>
        <div class="tx-info">
          <div class="tx-title">→ ${tx.beneficiaire || tx.beneficiaryNumber}</div>
          <div class="tx-sub">${tx.operateur?.toUpperCase() || '—'} · ${fmtDate(tx.createdAt)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tx-amount debit">${window.formatMoney(tx.montant, tx.currency || 'CDF')}</div>
          <span class="badge ${badges[tx.statut] || 'badge-warning'}" style="font-size:.7rem;">${labels[tx.statut] || tx.statut}</span>
        </div>
      </div>`;
    }).join('');
  });
}

// ── PIN Modal global ──
function showPinModal(message, callback) {
  let existing = document.getElementById('pinModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'pinModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal" style="max-width:340px;">
      <div class="modal-header">
        <h3 class="modal-title">🔐 PIN de sécurité</h3>
        <button class="modal-close" id="pinClose">✕</button>
      </div>
      <p style="font-size:.88rem;color:var(--c-text2);margin-bottom:16px;">${message}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:20px;" id="pinDots">
        ${[1,2,3,4,5,6].map(i=>`<div id="pd${i}" style="width:16px;height:16px;border-radius:50%;border:2px solid var(--c-primary);transition:.2s;"></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;" id="pinPad">
        ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k=>`<button class="btn btn-outline" style="font-size:1.1rem;padding:14px;" data-k="${k}">${k}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(modal);

  let pin = '';
  function updateDots() {
    for(let i=1;i<=6;i++){
      document.getElementById('pd'+i).style.background = i<=pin.length ? 'var(--c-primary)' : 'transparent';
    }
  }
  modal.querySelectorAll('#pinPad button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k === '⌫') { pin = pin.slice(0,-1); updateDots(); }
      else if (k !== '' && pin.length < 6) { pin += k; updateDots(); }
      if (pin.length === 6) {
        modal.remove();
        callback(pin);
      }
    });
  });
  document.getElementById('pinClose').addEventListener('click', () => modal.remove());
}
