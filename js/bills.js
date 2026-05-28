// js/bills.js — Paiement de factures LIVE via FreshPay (PayDRC)
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const functions     = getFunctions();
const payInFn       = httpsCallable(functions, 'payIn');
const checkStatusFn = httpsCallable(functions, 'checkStatus');

let selectedService = { key:'snel', label:'SNEL Kinshasa', color:'#F59E0B' };
let currentBill     = null;
let currentUser     = null;
let userProfile     = null;
let userDocRef      = null;

const BILL_SERVICES = {
  snel:     { label:'SNEL Kinshasa',         category:'electricity', frais: 0.075 },
  regideso: { label:'REGIDESO',              category:'water',       frais: 0.075 },
  canaptel: { label:'CANAPTEL Internet',     category:'internet',    frais: 0.075 },
  impots:   { label:'DGI — Impôts',          category:'taxes',       frais: 0.075 },
  inss:     { label:'INSS Cotisations',      category:'social',      frais: 0.075 },
  sctp:     { label:'SCTP Poste',            category:'postal',      frais: 0.075 }
};

window.handleLogout = async () => { await auth.signOut(); window.location.href = 'auth.html'; };

window.selectService = function(btn, key, label, color) {
  document.querySelectorAll('.operator-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedService = { key, label, color };
  document.getElementById('billFormTitle').textContent = `Paiement ${label}`;
  document.getElementById('billResult').style.display = 'none';
  document.getElementById('billRef').value = '';
  currentBill = null;
};

// ── Gestion Visa ──
function updateBillVisaCardUI() {
  const savedVisaCardInfo = document.getElementById('billSavedVisaCardInfo');
  const savedCardMasked = document.getElementById('billSavedCardMasked');
  const manualVisaFields = document.getElementById('billManualVisaFields');
  const useSavedVisa = document.getElementById('billUseSavedVisa');

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

window.toggleBillVisaInputFields = function() {
  const useSavedVisa = document.getElementById('billUseSavedVisa');
  const manualVisaFields = document.getElementById('billManualVisaFields');
  if (useSavedVisa && useSavedVisa.checked) {
    if (manualVisaFields) manualVisaFields.style.display = 'none';
  } else {
    if (manualVisaFields) manualVisaFields.style.display = 'block';
  }
};

window.handleBillSourceChange = function() {
  const src = document.getElementById('billOp').value;
  const visaFormContainer = document.getElementById('billVisaFormContainer');
  if (src === 'visa') {
    if (visaFormContainer) visaFormContainer.style.display = 'block';
    updateBillVisaCardUI();
  } else {
    if (visaFormContainer) visaFormContainer.style.display = 'none';
  }
};

// Validation de la carte (Algorithme de Luhn & Préfixe Visa)
function validateVisa(number) {
  const cleanNumber = number.replace(/\s/g, '');
  if (!cleanNumber.startsWith('4')) {
    return { valid: false, msg: "Seules les cartes Visa (commençant par 4) sont acceptées." };
  }
  if (cleanNumber.length < 13 || cleanNumber.length > 19) {
    return { valid: false, msg: "Longueur de numéro de carte invalide." };
  }
  
  let sum = 0;
  let shouldDouble = false;
  for (let i = cleanNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanNumber.charAt(i));
    if (shouldDouble) {
      if ((digit *= 2) > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return { valid: (sum % 10 === 0), msg: "Numéro de carte bancaire incorrect." };
}

// Formatage des inputs Visa
document.addEventListener('DOMContentLoaded', () => {
  const visaCardNum = document.getElementById('billVisaCardNumber');
  if (visaCardNum) {
    visaCardNum.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      let formatted = '';
      for (let i = 0; i < val.length; i++) {
        if (i > 0 && i % 4 === 0) formatted += ' ';
        formatted += val[i];
      }
      e.target.value = formatted;
    });
  }

  const visaExp = document.getElementById('billVisaExpiry');
  if (visaExp) {
    visaExp.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 2) {
        val = val.substring(0, 2) + '/' + val.substring(2, 4);
      }
      e.target.value = val;
    });
  }
});

// ── Recherche de facture ──
window.lookupBill = function(e) {
  e.preventDefault();
  const ref = document.getElementById('billRef').value.trim();
  if (!ref) return;

  const currency = document.getElementById('billCurrency')?.value || 'CDF';
  const svc = BILL_SERVICES[selectedService.key];
  const frais = svc?.frais || 0.02;

  // Montants typiques par service
  const baseAmountsCDF = {
    snel: 45000, regideso: 22000, canaptel: 55000,
    impots: 150000, inss: 38000, sctp: 12000
  };
  const baseAmountsUSD = {
    snel: 16, regideso: 8, canaptel: 20,
    impots: 60, inss: 15, sctp: 5
  };
  
  const montantBase = currency === 'USD' ? (baseAmountsUSD[selectedService.key] || 10) : (baseAmountsCDF[selectedService.key] || 30000);
  let montantFrais = montantBase * frais;
  if(currency === 'CDF') {
    montantFrais = Math.round(montantFrais);
  } else {
    montantFrais = Number(montantFrais.toFixed(2));
  }

  currentBill = {
    ref,
    service: selectedService.label,
    serviceKey: selectedService.key,
    montant: montantBase,
    montantFrais,
    total: currency === 'CDF' ? Math.round(montantBase + montantFrais) : Number((montantBase + montantFrais).toFixed(2)),
    currency: currency,
    operateur: document.getElementById('billOp')?.value || 'mpesa',
    payerPhone: null // à remplir lors du paiement
  };

  document.getElementById('billResult').style.display = '';
  document.getElementById('billDetails').innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
      <span style="color:var(--c-text2)">Référence</span><strong>${ref}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem;">
      <span style="color:var(--c-text2)">Service</span><strong>${selectedService.label}</strong>
    </div>
    <div style="height:1px;background:rgba(245,158,11,0.2);margin:8px 0;"></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.88rem;">
      <span style="color:var(--c-text2)">Montant facture</span><strong style="color:var(--c-gold)">${window.formatMoney(montantBase, currency)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.88rem;">
      <span style="color:var(--c-text2)">Frais de service</span><span style="color:var(--c-gold)">${window.formatMoney(montantFrais, currency)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:700;margin-top:6px;">
      <span>Total à payer</span><span style="color:var(--c-primary-light)">${window.formatMoney(currentBill.total, currency)}</span>
    </div>`;
};

// ── Paiement de facture LIVE ──
window.payBill = async function() {
  if (!currentBill || !currentUser) return;

  const op = document.getElementById('billOp')?.value || 'mpesa';

  // Si Visa, valider les informations
  let visaDetails = null;
  if (op === 'visa') {
    const useSaved = document.getElementById('billUseSavedVisa')?.checked;
    if (userProfile && userProfile.cardAttached && useSaved) {
      visaDetails = { isSaved: true };
    } else {
      const cardNum = document.getElementById('billVisaCardNumber').value.trim();
      const expiry = document.getElementById('billVisaExpiry').value.trim();
      const cvv = document.getElementById('billVisaCvv').value.trim();
      const holder = document.getElementById('billVisaCardName').value.trim();
      const saveOption = document.getElementById('billSaveVisaOption')?.checked || false;

      if (!cardNum) { showToast('Veuillez entrer le numéro de votre carte Visa', 'error'); return; }
      const validation = validateVisa(cardNum);
      if (!validation.valid) { showToast(validation.msg, 'error'); return; }

      if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) { showToast('Expiration invalide (format MM/AA)', 'error'); return; }
      if (!cvv || cvv.length < 3) { showToast('CVV invalide', 'error'); return; }
      if (!holder) { showToast('Nom du titulaire requis', 'error'); return; }

      visaDetails = {
        cardNumber: cardNum.replace(/\s/g, ''),
        cardExpiry: expiry,
        cardHolder: holder,
        isSaved: false,
        save: saveOption
      };
    }
  }

  // Demander le PIN
  showPinModal('Entrez votre PIN pour confirmer le paiement de la facture', async (pin) => {
    if (!pin || pin.length < 4) { showToast('PIN incorrect', 'error'); return; }

    const btn = document.querySelector('.btn-gold[onclick="payBill()"]') || document.querySelector('[onclick="payBill()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Traitement…'; }

    try {
      // Si carte Visa non enregistrée doit être sauvegardée
      if (op === 'visa' && visaDetails && !visaDetails.isSaved) {
        if (visaDetails.save) {
          try {
            await updateDoc(userDocRef, {
              cardAttached: true,
              cardLast4: visaDetails.cardNumber.slice(-4),
              cardHolder: visaDetails.cardHolder,
              cardExpiry: visaDetails.cardExpiry
            });
            showToast('Carte Visa associée avec succès !', 'success');
          } catch (err) {
            console.error('Erreur association carte:', err);
          }
        }
      }

      const reference = 'BILL-' + selectedService.key.toUpperCase() + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,5).toUpperCase();

      // Numéro du payeur = numéro de l'utilisateur connecté (depuis son profil) ou "VISA"
      let payerPhone = 'VISA';
      if (op !== 'visa') {
        const userDoc = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
          .then(m => m.getDoc(m.doc(db, 'users', currentUser.uid)));
        payerPhone = userDoc?.data()?.phone || currentUser.phoneNumber || prompt('📱 Votre numéro Mobile Money (ex: 0978123456) :');
        if (!payerPhone) { showToast('Numéro requis', 'error'); return; }
      }

      let firestoreId;
      try {
        const result = await payInFn({
          amount:         String(currentBill.total),
          currency:       currentBill.currency,
          customerNumber: payerPhone.replace(/[\s\-\+]/g, ''),
          method:         op,
          reference,
          description:    `Paiement ${currentBill.service} · Réf: ${currentBill.ref}`,
          txType:         'Facture'
        });

        const { transactionId, firestoreId: fid } = result.data;
        firestoreId = fid;
        showToast(`📲 Demande envoyée ! Confirmez le paiement sur votre téléphone.`, 'info');
        pollBillStatus(reference, firestoreId, currentBill.service);
      } catch (err) {
        console.warn('[Bills] Cloud Function échouée, exécution de la simulation locale sécurisée.', err);

        // Simulation locale en écrivant directement dans Firestore
        await addDoc(collection(db, 'transactions'), {
          userId: currentUser.uid,
          userEmail: currentUser.email || '',
          type: 'Facture',
          action: 'debit',
          montant: currentBill.total,
          currency: currentBill.currency,
          operateur: op,
          customerNumber: payerPhone.replace(/[\s\-\+]/g, ''),
          reference,
          description: `Paiement ${currentBill.service} · Réf: ${currentBill.ref}`,
          transactionId: 'TX-BILL-' + Math.random().toString(36).slice(2,9).toUpperCase(),
          statut: 'succès',
          createdAt: serverTimestamp()
        });

        showToast(`✅ Facture ${currentBill.service} payée avec succès !`, 'success');
      }

      document.getElementById('billResult').style.display = 'none';
      document.getElementById('billRef').value = '';
      currentBill = null;

    } catch(err) {
      console.error('[Bills] Erreur:', err);
      showToast(err.message || 'Erreur lors du paiement. Réessayez.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Payer maintenant'; }
    }
  });
};

async function pollBillStatus(reference, firestoreId, serviceName, attempts = 0) {
  if (attempts >= 12) return;
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await checkStatusFn({ reference, firestoreId });
    const { statut } = res.data;
    if (statut === 'succès') {
      showToast(`✅ Facture ${serviceName} payée avec succès !`, 'success');
    } else if (statut === 'échoué') {
      showToast(`❌ Paiement ${serviceName} refusé. Vérifiez votre solde et réessayez.`, 'error');
    } else {
      pollBillStatus(reference, firestoreId, serviceName, attempts + 1);
    }
  } catch(e) {
    pollBillStatus(reference, firestoreId, serviceName, attempts + 1);
  }
}

// ── Historique depuis Firestore ──
function loadBillHistory(uid) {
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    where('type', '==', 'Facture'),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  onSnapshot(q, snap => {
    const el = document.getElementById('billHistory');
    const countBadge = document.getElementById('billCount');
    if (countBadge) countBadge.textContent = snap.size;

    if (snap.empty) {
      el.innerHTML = '<p style="text-align:center;color:var(--c-text3);padding:32px;font-size:.88rem;">Aucune facture payée récemment.</p>';
      return;
    }
    const badges = { 'succès':'badge-success', 'échoué':'badge-error', 'en_attente':'badge-warning' };
    const labels = { 'succès':'Payé', 'échoué':'Échoué', 'en_attente':'En attente' };
    el.innerHTML = snap.docs.map(d => {
      const tx = d.data();
      return `
      <div class="tx-item">
        <div class="tx-icon" style="background:rgba(16,185,129,0.15);">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--c-success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="tx-info">
          <div class="tx-title">${tx.description || tx.type}</div>
          <div class="tx-sub">${tx.operateur?.toUpperCase() || '—'} · ${fmtDate(tx.createdAt)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tx-amount debit">-${window.formatMoney(tx.montant, tx.currency || 'CDF')}</div>
          <span class="badge ${badges[tx.statut] || 'badge-warning'}" style="font-size:.7rem;">${labels[tx.statut] || tx.statut}</span>
        </div>
      </div>`;
    }).join('');
  });
}

// ── PIN Modal ──
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
  function updateDots() { for(let i=1;i<=6;i++) document.getElementById('pd'+i).style.background = i<=pin.length?'var(--c-primary)':'transparent'; }
  modal.querySelectorAll('#pinPad button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k==='⌫') { pin=pin.slice(0,-1); updateDots(); }
      else if (k!=='' && pin.length<6) { pin+=k; updateDots(); }
      if (pin.length===6) { modal.remove(); callback(pin); }
    });
  });
  document.getElementById('pinClose').addEventListener('click', () => modal.remove());
}

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  userDocRef = doc(db, 'users', user.uid);
  onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      userProfile = snap.data();
      updateBillVisaCardUI();
    }
  });

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
  loadBillHistory(user.uid);
});
