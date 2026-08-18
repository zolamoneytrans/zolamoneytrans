import { 
  auth, db, storage, getDoc, doc, updateDoc, serverTimestamp, onAuthStateChanged, collection, query, where, orderBy, limit, getDocs, onSnapshot, signOut 
} from './firebase.js';
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let currentUser = null;
let agentData = null;

// Auth Guard
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadAgentData();
  } else {
    window.location.href = 'auth.html';
  }
});

window.handleLogout = async () => {
  await signOut(auth);
  window.location.href = 'auth.html';
};

window.toggleSidebar = () => {
  const sb = document.getElementById('sidebar');
  const ov = document.querySelector('.sidebar-overlay');
  if (sb) sb.classList.toggle('open');
  if (ov) ov.classList.toggle('open');
};

// View Navigation Logic
function switchView(viewId) {
  // Update nav items
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
    el.classList.remove('active');
    if(el.dataset.view === viewId) el.classList.add('active');
  });

  // Update view sections
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const activeView = document.getElementById(`view-${viewId}`);
  if(activeView) activeView.classList.add('active');

  // Update Page Title
  const titles = {
    home: "Tableau de Bord",
    transactions: "Transactions",
    commissions: "Mes Commissions",
    tutorial: "Guide & Tutoriel",
    profile: "Mon Profil",
    documents: "Mes Documents",
    support: "Support"
  };
  document.getElementById('pageTitle').innerText = titles[viewId] || "Tableau de Bord";
  
  if (window.innerWidth <= 768) {
      const sb = document.querySelector('.sidebar');
      const ov = document.querySelector('.sidebar-overlay');
      if (sb) sb.classList.remove('open');
      if (ov) ov.classList.remove('open');
  }
}

// Add event listeners to nav items
document.querySelectorAll('[data-view]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const viewId = item.dataset.view;
    switchView(viewId);
  });
});

async function loadAgentData() {
  document.getElementById('loadingScreen').style.display = 'flex';
  
  try {
    const docSnap = await getDoc(doc(db, 'agents', currentUser.uid));
    if (docSnap.exists()) {
      agentData = docSnap.data();
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      if ((userSnap.exists() && userSnap.data().blocked === true) || agentData.blocked === true) {
        await signOut(auth);
        window.location.href = 'auth.html';
        return;
      }
      
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('appShell').style.display = 'block';
      if (userSnap.exists() && window.checkAndShowKycReminder) window.checkAndShowKycReminder(userSnap.data());

      if (agentData.status === 'rejected' || agentData.kycStatus === 'rejete') {
        document.getElementById('pendingOverlay').style.display = 'none';
        document.getElementById('rejectedOverlay').style.display = 'block';
        document.getElementById('approvedContent').style.display = 'none';
        const reasonEl = document.getElementById('rejectionReasonText');
        if (reasonEl) reasonEl.innerText = agentData.kycRejectionReason || "Document d'identité ou photo non conforme.";
        return;
      }

      if (agentData.status === 'pending') {
        document.getElementById('pendingOverlay').style.display = 'block';
        document.getElementById('rejectedOverlay') && (document.getElementById('rejectedOverlay').style.display = 'none');
        document.getElementById('approvedContent').style.display = 'none';
        return;
      }

      document.getElementById('pendingOverlay').style.display = 'none';
      document.getElementById('rejectedOverlay') && (document.getElementById('rejectedOverlay').style.display = 'none');
      document.getElementById('approvedContent').style.display = 'block';
      
      populateDashboard();
    } else {
      // Not an agent
      window.location.href = 'dashboard.html';
    }
  } catch (err) {
    console.error("Error loading agent data: ", err);
    window.showToast?.("Erreur de chargement", "error");
  }
}

function populateDashboard() {
  // Sidebar & Topbar
  const fullNameStr = `${agentData.firstName || ''} ${agentData.lastName || ''}`.trim();
  document.getElementById('sidebarAgentName').innerText = fullNameStr;
  document.getElementById('sidebarAgentTier').innerText = agentData.tier ? (agentData.tier.charAt(0).toUpperCase() + agentData.tier.slice(1)) : 'Actif';
  
  const userAvatarEl = document.getElementById('userAvatar');
  const sidebarAvatarEl = document.getElementById('sidebarAvatar');
  const photoCircleEl = document.getElementById('profilePhotoCircle');
  if (agentData.photoURL) {
    const imgHtml = `<img src="${agentData.photoURL}" style="width:100%; height:100%; object-fit:cover;" />`;
    if (userAvatarEl) userAvatarEl.innerHTML = imgHtml;
    if (sidebarAvatarEl) sidebarAvatarEl.innerHTML = imgHtml;
    if (photoCircleEl && !window._tempProfilePhotoData) photoCircleEl.innerHTML = imgHtml;
  } else {
    const initChar = (agentData.firstName || 'A').charAt(0).toUpperCase();
    if (userAvatarEl) userAvatarEl.innerText = initChar;
    if (sidebarAvatarEl) sidebarAvatarEl.innerText = initChar;
    if (photoCircleEl && !window._tempProfilePhotoData) photoCircleEl.innerText = initChar;
  }

  // Home
  document.getElementById('welcomeName').innerText = agentData.firstName;
  document.getElementById('agentRefDisplay').innerText = agentData.agentCode || "En attente d'attribution";
  
  document.getElementById('kpiCommWeek').innerText = window.fmtCDF ? window.fmtCDF(agentData.commissions.pending) : agentData.commissions.pending + " CDF";
  document.getElementById('kpiTotalAll') && (document.getElementById('kpiTotalAll').innerText = window.fmtCDF ? window.fmtCDF(agentData.commissions.total) : agentData.commissions.total + " CDF");
  
  // Profile
  document.getElementById('profName').innerText = fullNameStr;
  document.getElementById('profEmail').innerText = agentData.email;
  document.getElementById('profPhone').innerText = agentData.phone;
  document.getElementById('profBusiness').innerText = agentData.businessName;
  document.getElementById('profAddress').innerText = `${agentData.address || ''}, ${agentData.commune || ''}, ${agentData.province || ''}`;
  
  const settingFN = document.getElementById('settingFullName');
  if (settingFN) settingFN.value = fullNameStr;
  const settingBN = document.getElementById('settingBusinessName');
  if (settingBN) settingBN.value = agentData.businessName || '';

  let opDisplay = "M-Pesa";
  if(agentData.selectedOperator === "airtel") opDisplay = "Airtel Money";
  else if(agentData.selectedOperator === "orange") opDisplay = "Orange Money";
  else if(agentData.selectedOperator === "afrimoney") opDisplay = "Afrimoney";
  
  const activeMmPhone = agentData.mmPhone || agentData.phone || '';
  document.getElementById('profMmAccount').innerText = `${opDisplay} - ${activeMmPhone}`;

  const settingOp = document.getElementById('settingMmOp');
  const settingPhone = document.getElementById('settingMmPhone');
  if(settingOp) settingOp.value = agentData.selectedOperator || 'mpesa';
  if(settingPhone) {
    let ph = activeMmPhone;
    if(ph.startsWith('+243')) ph = ph.slice(4);
    else if(ph.startsWith('243')) ph = ph.slice(3);
    else if(ph.startsWith('0')) ph = ph.slice(1);
    settingPhone.value = ph;
  }

  // Commissions
  document.getElementById('commTotalAll').innerText = window.fmtCDF ? window.fmtCDF(agentData.commissions.total) : agentData.commissions.total + " CDF";
  document.getElementById('commPending').innerText = window.fmtCDF ? window.fmtCDF(agentData.commissions.pending) : agentData.commissions.pending + " CDF";
  document.getElementById('commPaid').innerText = window.fmtCDF ? window.fmtCDF(agentData.commissions.released) : agentData.commissions.released + " CDF";

  initCharts();
  listenAgentTransactions();
}

let unsubQ1 = null;
let unsubQ2 = null;

function listenAgentTransactions() {
  if (!currentUser) return;
  if (unsubQ1 || unsubQ2) return;
  
  // Listen to transactions where user is creator (userId) OR agent (agentUid)
  const q1 = query(collection(db, 'transactions'), where('userId', '==', currentUser.uid));
  const q2 = query(collection(db, 'transactions'), where('agentUid', '==', currentUser.uid));
  
  const docsMap = new Map();

  const renderAll = () => {
    const docs = Array.from(docsMap.values());
    docs.sort((a, b) => {
      const tA = a.createdAt?.toMillis?.() || 0;
      const tB = b.createdAt?.toMillis?.() || 0;
      return tB - tA;
    });

    let count = 0;
    let volCDF = 0;
    let html = '';
    let commHtml = '';
    let commCount = 0;

    docs.forEach(tx => {
      const isConfirmed = tx.status === 'confirmed' || tx.statut === 'succès';
      if (isConfirmed) {
        count++;
        volCDF += (tx.amount || tx.montant || 0);
      }
      
      const dateStr = tx.createdAt?.toDate?.() ? tx.createdAt.toDate().toLocaleString('fr-FR') : 'À l\'instant';
      const isCashin = tx.type === 'cashin' || tx.type === 'depot' || tx.type === 'card_deposit';
      const isCard = tx.type === 'card_deposit';
      
      const typeBadge = isCard
        ? '<span style="background:rgba(59,130,246,0.15); color:#60A5FA; padding:6px 10px; border-radius:8px; font-weight:700; font-size:0.8rem;">💳 Encaissement CB</span>'
        : (isCashin
          ? '<span style="background:rgba(16,185,129,0.15); color:#10B981; padding:6px 10px; border-radius:8px; font-weight:700; font-size:0.8rem;">Dépôt (Cash-In)</span>'
          : '<span style="background:rgba(245,158,11,0.15); color:#F59E0B; padding:6px 10px; border-radius:8px; font-weight:700; font-size:0.8rem;">Retrait (Cash-Out)</span>');
          
      const destOp = (tx.customerDestOperator || tx.operator || tx.bank || 'Mobile').toUpperCase();
      const clientPh = tx.customerDestPhone || tx.customerPhone || tx.cardHolder || '-';
      const origAmt = tx.amountOriginal ? `${tx.amountOriginal} ${tx.currencyOriginal || ''}` : `${tx.amount || tx.montant || 0} CDF`;
      
      let commVal = tx.agentCommission || 0;
      if (!commVal && (tx.amountOriginal || tx.amount || tx.montant)) {
        commVal = Math.round((tx.amountOriginal || tx.amount || tx.montant) * 0.004);
      }
      const comm = (isConfirmed && commVal) ? `+${Math.round(commVal)} CDF` : '0 CDF';

      let statusBadge = '<span style="background:rgba(16,185,129,0.2); color:#10B981; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">✅ Succès</span>';
      if (tx.status === 'en_attente_ussd' || tx.status === 'pending' || tx.statut === 'en_attente') {
        statusBadge = '<span style="background:rgba(59,130,246,0.2); color:#60A5FA; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">⏳ Attente Validation</span>';
      } else if (tx.status === 'en_cours_payout') {
        statusBadge = '<span style="background:rgba(245,158,11,0.2); color:#FCD34D; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">🔄 Envoi Payout</span>';
      } else if (tx.status === 'failed' || tx.statut === 'échoué') {
        statusBadge = `<span style="background:rgba(239,68,68,0.2); color:#EF4444; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;" title="${tx.errorReason || 'Erreur'}">❌ Échec</span>`;
      }

      html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 14px 12px; color:#E2E8F0;">${dateStr}</td>
          <td style="padding: 14px 12px;">${typeBadge}</td>
          <td style="padding: 14px 12px; font-weight:600; color:#FFFFFF;">${destOp} <span style="color:#94A3B8; font-weight:normal;">(${clientPh})</span></td>
          <td style="padding: 14px 12px; font-weight:700; color:#FFFFFF; font-size:0.95rem;">${origAmt}</td>
          <td style="padding: 14px 12px; color:#FCD34D; font-weight:700;">${comm}</td>
          <td style="padding: 14px 12px;">${statusBadge}</td>
        </tr>
      `;

      // Build Commissions Table Row
      if (isConfirmed || commVal > 0) {
        commCount++;
        const refDisplay = tx.reference || (tx.id ? tx.id.slice(0, 8).toUpperCase() : 'TX');
        const commDisplay = `+${Math.round(commVal)} CDF (0.4%)`;
        const claimStatusBadge = '<span style="background:rgba(245,158,11,0.2); color:#FCD34D; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">⏳ En attente mensuelle</span>';
        
        commHtml += `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 14px 12px;"><div style="font-weight:700; color:#FFF; font-family:monospace;">${refDisplay}</div><div style="font-size:0.75rem; color:#94A3B8;">${dateStr}</div></td>
            <td style="padding: 14px 12px;">${typeBadge}</td>
            <td style="padding: 14px 12px; font-weight:700; color:#E2E8F0;">${origAmt}</td>
            <td style="padding: 14px 12px; color:#10B981; font-weight:800; font-size:0.95rem;">${commDisplay}</td>
            <td style="padding: 14px 12px;">${claimStatusBadge}</td>
          </tr>
        `;
      }
    });

    if (docs.length === 0) {
      html = '<tr><td colspan="6" style="text-align:center; padding: 24px; color: #94A3B8;">Aucune transaction effectuée</td></tr>';
    }

    const txBody = document.getElementById('txListBody');
    if (txBody) txBody.innerHTML = html;

    const commBody = document.getElementById('commListBody');
    if (commBody) commBody.innerHTML = commHtml || '<tr><td colspan="5" style="text-align:center; padding: 24px; color: #94A3B8;">Aucune commission enregistrée pour l\'instant</td></tr>';

    const kpiTx = document.getElementById('kpiTxMonth');
    const kpiVol = document.getElementById('kpiVolMonth');
    if (kpiTx) kpiTx.innerText = count;
    if (kpiVol) kpiVol.innerText = window.fmtCDF ? window.fmtCDF(volCDF) : volCDF + ' CDF';

    const pendingComm = (agentData && agentData.commissions && agentData.commissions.pending) || 0;
    const claimBtnAmt = document.getElementById('claimBtnAmt');
    if (claimBtnAmt) claimBtnAmt.innerText = window.fmtCDF ? window.fmtCDF(pendingComm) : pendingComm + ' CDF';
  };

  unsubQ1 = onSnapshot(q1, (snapshot) => {
    snapshot.forEach(d => docsMap.set(d.id, { id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("Erreur listener q1:", err));

  unsubQ2 = onSnapshot(q2, (snapshot) => {
    snapshot.forEach(d => docsMap.set(d.id, { id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("Erreur listener q2:", err));
}

window.claimAgentPay = async function() {
  if (!currentUser || !agentData) return;
  const pendingAmt = (agentData.commissions && agentData.commissions.pending) || 0;
  if (pendingAmt <= 0) {
    alert("Vous n'avez actuellement aucune commission en attente de versement.");
    return;
  }
  
  if (!confirm(`Voulez-vous réclamer le versement de vos commissions cumulées (${window.fmtCDF ? window.fmtCDF(pendingAmt) : pendingAmt + ' CDF'}) vers votre caisse Mobile Money ?\n\nConformément aux règles Zola Money Trans, le versement s'effectue à cycle mensuel après validation par l'Administration.`)) {
    return;
  }

  const btn = document.getElementById('btnClaimCommissions');
  const origText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Transmission...'; }

  try {
    await addDoc(collection(db, 'commission_claims'), {
      agentUid: currentUser.uid,
      agentCode: agentData.code || 'ZMT-AG',
      agentName: agentData.name || 'Agent Zola',
      agentPhone: activeMmPhone || agentData.phone || '',
      operator: agentData.selectedOperator || 'mpesa',
      amount: pendingAmt,
      status: 'pending',
      requestedAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'agents', currentUser.uid), {
      lastClaimRequestedAt: serverTimestamp()
    });

    alert("✅ Votre demande de paiement de commissions a été transmise au tableau de bord de l'Administration avec succès !\n\nVous recevrez votre transfert sur votre compte Mobile Money dès validation.");
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  } catch (err) {
    console.error("Erreur réclamation commissions:", err);
    alert("Erreur lors de l'envoi de la demande : " + err.message);
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
};

let commChartInstance = null;

function initCharts() {
  const ctx = document.getElementById('commChart');
  if(!ctx) return;
  if (commChartInstance) {
    commChartInstance.destroy();
    commChartInstance = null;
  }
  if (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') {
    const existing = Chart.getChart('commChart') || Chart.getChart(ctx);
    if (existing) existing.destroy();
  }
  commChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
      datasets: [{
        label: 'Commissions (CDF)',
        data: [12000, 19000, 15000, 22000],
        backgroundColor: '#6B4EFF',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

// --- Commission Calculator & Modals ---
const USD_RATE = 2800;

function calculateRetraitClientFees(amt, curr) {
  if (curr === 'USD') {
    return Number((amt * 0.095).toFixed(2));
  } else {
    return Math.round(amt * 0.095);
  }
}

function calculateAgentCommission(amount, type, currency) {
  let amtCDF = currency === 'USD' ? amount * USD_RATE : amount;
  let commission = 0;

  if (type === 'depot') {
    if (amtCDF >= 500 && amtCDF <= 5000) commission = 50;
    else if (amtCDF > 5000 && amtCDF <= 20000) commission = amtCDF * 0.004;
    else if (amtCDF > 20000 && amtCDF <= 500000) commission = amtCDF * 0.005;
    else if (amtCDF > 500000) commission = amtCDF * 0.004;
  } else if (type === 'retrait') {
    let fraisClientCDF = Math.round(amtCDF * 0.095);
    commission = fraisClientCDF * 0.45;
  }

  return Math.round(commission);
}

window.openTxModal = (type) => {
  const modal = document.getElementById('txModal');
  if(!modal) return;
  modal.style.display = 'flex';
  document.getElementById('txModalTitle').innerText = type === 'depot' ? 'Nouveau Dépôt (Cash-In)' : 'Nouveau Retrait (Cash-Out)';
  modal.dataset.txType = type;
  document.getElementById('txAmount').value = '';
  document.getElementById('txPhone').value = '';
  document.getElementById('txCommissionDisplay').innerText = '0 CDF';

  const navDepot = document.getElementById('txNavDepotBtn');
  const navRetrait = document.getElementById('txNavRetraitBtn');
  if (navDepot && navRetrait) {
    if (type === 'depot') {
      navDepot.style.background = 'linear-gradient(135deg, #10B981, #059669)';
      navDepot.style.color = '#FFFFFF';
      navDepot.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
      navRetrait.style.background = 'transparent';
      navRetrait.style.color = '#94A3B8';
      navRetrait.style.boxShadow = 'none';
    } else {
      navRetrait.style.background = 'linear-gradient(135deg, #3B82F6, #1D4ED8)';
      navRetrait.style.color = '#FFFFFF';
      navRetrait.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
      navDepot.style.background = 'transparent';
      navDepot.style.color = '#94A3B8';
      navDepot.style.boxShadow = 'none';
    }
  }

  const breakdown = document.getElementById('txRetraitBreakdown');
  if (breakdown) {
    breakdown.style.display = type === 'retrait' ? 'flex' : 'none';
  }
  const fraisEl = document.getElementById('txFraisDisplay');
  if (fraisEl) fraisEl.innerText = '0';
  const totalDebitedEl = document.getElementById('txTotalDebitedDisplay');
  if (totalDebitedEl) totalDebitedEl.innerText = '0';

  const opSelect = document.getElementById('txOperator');
  if(opSelect && agentData && agentData.selectedOperator) {
    opSelect.value = agentData.selectedOperator;
  }

  const sourceText = document.getElementById('txAgentSourceText');
  if(sourceText) {
    const agentPhone = agentData ? (agentData.mmPhone || agentData.phone || 'Non défini') : '';
    const agentOp = agentData ? (agentData.selectedOperator || 'M-Pesa').toUpperCase() : '';
    if (type === 'depot') {
      sourceText.innerHTML = `Prélèvement sur votre compte Agent <strong style="color:#FCD34D;">${agentOp} (${agentPhone})</strong> pour créditer le client.`;
    } else {
      sourceText.innerHTML = `Envoi d'un push USSD au client pour valider le retrait vers votre caisse Agent <strong style="color:#FCD34D;">(${agentPhone})</strong>.`;
    }
  }
};

window.openMyQR = () => {
  const modal = document.getElementById('qrModal');
  if(!modal) return;
  modal.style.display = 'flex';
  document.getElementById('qrAgentName').innerText = agentData ? agentData.firstName + ' ' + agentData.lastName : '';
  const code = agentData && agentData.agentCode ? agentData.agentCode : 'EN_ATTENTE';
  document.getElementById('qrAgentCodeDisplay').innerText = code;
  
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=ZOLA:${code}`;
  document.getElementById('qrcodeContainer').innerHTML = `<img src="${qrUrl}" alt="QR Code" />`;
};

window.openScanQR = () => {
  window.showToast?.("Module Scanner en cours d'intégration", "info");
};

window.openCardModal = () => {
  const modal = document.getElementById('cardModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const amtInput = document.getElementById('cardAmount');
  if (amtInput) amtInput.value = '';
  const genArea = document.getElementById('cardGeneratedArea');
  if (genArea) genArea.style.display = 'none';
  const fraisDisp = document.getElementById('cardFraisDisplay');
  if (fraisDisp) fraisDisp.innerText = '0 USD';
  const totalDisp = document.getElementById('cardTotalDisplay');
  if (totalDisp) totalDisp.innerText = '0 USD';

  const targetText = document.getElementById('cardAgentTargetText');
  if (targetText && agentData) {
    const agentPhone = agentData.mmPhone || agentData.phone || 'Non défini';
    const agentOp = (agentData.selectedOperator || 'M-Pesa').toUpperCase();
    targetText.innerHTML = `${agentOp} (${agentPhone})`;
  }
};

window.updateCardFeeBreakdown = () => {
  const amt = parseFloat(document.getElementById('cardAmount')?.value) || 0;
  const curr = document.getElementById('cardCurrency')?.value || 'USD';
  const fees = amt * 0.095;
  const total = amt + fees;
  const formatVal = (v) => curr === 'CDF' ? (window.fmtCDF ? window.fmtCDF(v) : Math.round(v).toLocaleString('fr-FR') + ' CDF') : (v.toFixed(2) + ' USD');
  const fraisDisp = document.getElementById('cardFraisDisplay');
  if (fraisDisp) fraisDisp.innerText = formatVal(fees);
  const totalDisp = document.getElementById('cardTotalDisplay');
  if (totalDisp) totalDisp.innerText = formatVal(total);
};

window.copyCardLink = () => {
  const urlInput = document.getElementById('cardPaymentUrl');
  if (!urlInput || !urlInput.value) return;
  navigator.clipboard?.writeText(urlInput.value).then(() => {
    window.showToast?.("📋 Lien Moko Africa copié avec succès !", "success");
  }).catch(() => {
    urlInput.select();
    document.execCommand('copy');
    window.showToast?.("📋 Lien Moko Africa copié !", "success");
  });
};

window.shareCardWhatsApp = () => {
  const urlInput = document.getElementById('cardPaymentUrl');
  if (!urlInput || !urlInput.value) return;
  const bank = document.getElementById('cardBank')?.value || 'Banque/Visa';
  const totalText = document.getElementById('cardTotalDisplay')?.innerText || '';
  const msg = encodeURIComponent(`Bonjour,\nVeuillez cliquer sur ce lien sécurisé Moko Africa / FreshPay (${bank}) pour régler votre transaction de ${totalText} par carte Visa ou Mastercard :\n\n${urlInput.value}`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
};

window.simulateCardCustomerPayment = async () => {
  if (window._isSimulatingCard) return;
  window._isSimulatingCard = true;

  const amt = parseFloat(document.getElementById('cardAmount')?.value) || 0;
  const curr = document.getElementById('cardCurrency')?.value || 'USD';
  const bank = document.getElementById('cardBank')?.value || 'Visa/Mastercard';
  if (amt <= 0) {
    window._isSimulatingCard = false;
    window.showToast?.("Veuillez d'abord saisir un montant valide.", "warning");
    return;
  }
  window.showToast?.(`📱 Client : Saisie carte Visa (${bank}) sur son téléphone en cours...`, "info");
  const btn = document.querySelector('#cardGeneratedArea button');
  if (btn) btn.disabled = true;

  setTimeout(async () => {
    try {
      window.showToast?.(`🔐 Client : Validation 3D-Secure réussie ! Crédit en caisse...`, 'success');
      const { addDoc, collection, doc, updateDoc, serverTimestamp } = await import('./firebase.js');
      const db = (await import('./firebase.js')).db;

      const commVal = calculateAgentCommission(amt, 'depot', curr);

      await addDoc(collection(db, 'transactions'), {
        agentUid: (agentData && agentData.uid) || currentUser.uid || '',
        userId: currentUser.uid || '',
        agentCode: (agentData && agentData.agentCode) || '',
        type: 'card_deposit',
        bank: bank,
        cardHolder: 'CLIENT VIA LIEN VISA',
        amount: curr === 'USD' ? amt * USD_RATE : amt,
        currencyOriginal: curr,
        amountOriginal: amt,
        agentCommission: commVal,
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      const currentTotal = (agentData && agentData.commissions && agentData.commissions.total) || 0;
      const currentPending = (agentData && agentData.commissions && agentData.commissions.pending) || 0;
      const newTotal = currentTotal + commVal;
      const newPending = currentPending + commVal;

      await updateDoc(doc(db, 'agents', currentUser.uid), {
        'commissions.total': newTotal,
        'commissions.pending': newPending
      });
      if (!agentData.commissions) agentData.commissions = {};
      agentData.commissions.total = newTotal;
      agentData.commissions.pending = newPending;
      const kpiWeek = document.getElementById('kpiCommWeek');
      if (kpiWeek) kpiWeek.innerText = window.fmtCDF ? window.fmtCDF(newPending) : newPending + " CDF";

      const cf = document.getElementById('cardForm');
      if (cf) cf.reset();
      const genArea = document.getElementById('cardGeneratedArea');
      if (genArea) genArea.style.display = 'none';

      document.getElementById('cardModal').style.display = 'none';
      window.showToast?.(`🎉 Encaissement CB validé ! ${amt} ${curr} (${bank}) ont été versés dans votre caisse Agent !`, 'success');
    } catch (err) {
      console.error("Erreur simu CB:", err);
      window.showToast?.("Erreur de validation CB : " + err.message, "error");
    } finally {
      window._isSimulatingCard = false;
      if (btn) btn.disabled = false;
    }
  }, 2500);
};

// Event listener for real-time commission calculation
document.addEventListener('DOMContentLoaded', () => {
  const amountInput = document.getElementById('txAmount');
  const currInput = document.getElementById('txCurrency');
  
  const updateComm = () => {
    const amt = parseFloat(amountInput.value) || 0;
    const curr = currInput.value;
    const type = document.getElementById('txModal').dataset.txType;
    const comm = calculateAgentCommission(amt, type, curr);
    document.getElementById('txCommissionDisplay').innerText = (window.fmtCDF ? window.fmtCDF(comm) : comm + ' CDF');

    const breakdown = document.getElementById('txRetraitBreakdown');
    if (breakdown) {
      if (type === 'retrait') {
        breakdown.style.display = 'flex';
        const fraisVal = curr === 'USD' ? Number((amt * 0.095).toFixed(2)) : Math.round(amt * 0.095);
        const totalVal = curr === 'USD' ? Number((amt + fraisVal).toFixed(2)) : (amt + fraisVal);

        const fraisEl = document.getElementById('txFraisDisplay');
        const totalEl = document.getElementById('txTotalDebitedDisplay');

        if (fraisEl) {
          fraisEl.innerText = curr === 'USD' ? `${fraisVal} USD` : (window.fmtCDF ? window.fmtCDF(fraisVal) : `${fraisVal} CDF`);
        }
        if (totalEl) {
          totalEl.innerText = curr === 'USD' ? `${totalVal} USD` : (window.fmtCDF ? window.fmtCDF(totalVal) : `${totalVal} CDF`);
        }
      } else {
        breakdown.style.display = 'none';
      }
    }
  };

  if(amountInput) amountInput.addEventListener('input', updateComm);
  if(currInput) currInput.addEventListener('change', updateComm);

  // Form submit
  const txForm = document.getElementById('txForm');
  if(txForm) {
    txForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (txForm._isSubmitting) return;
      txForm._isSubmitting = true;

      const btn = document.getElementById('txSubmitBtn');
      if(btn) { btn.disabled = true; btn.innerText = 'Traitement...'; }
      
      const type = document.getElementById('txModal').dataset.txType;
      const amt = parseFloat(amountInput.value) || 0;
      const curr = currInput.value;
      const phone = document.getElementById('txPhone').value;
      const selectedOp = document.getElementById('txOperator')?.value || 'mpesa';
      const commVal = calculateAgentCommission(amt, type, curr);
      
      // Reset form immediately to prevent refresh replay
      txForm.reset();
      document.getElementById('txModal').style.display = 'none';

      try {
        const { addDoc, collection, doc, updateDoc, serverTimestamp } = await import('./firebase.js');
        const db = (await import('./firebase.js')).db;
        
        const agentPhoneSource = agentData.mmPhone || agentData.phone || '';
        const agentOpSource = agentData.selectedOperator || 'mpesa';

        // 1. Save Transaction initially
        const isDepot = type === 'depot';
        const feesVal = type === 'retrait' ? calculateRetraitClientFees(amt, curr) : 0;
        const totalUssdAmount = type === 'retrait' ? Number((amt + feesVal).toFixed(2)) : amt;

        const txRef = await addDoc(collection(db, 'transactions'), {
          agentUid: (agentData && agentData.uid) || currentUser.uid || '',
          userId: currentUser.uid || '',
          agentCode: (agentData && agentData.agentCode) || '',
          type: isDepot ? 'cashin' : 'cashout',
          operator: selectedOp,
          agentSourcePhone: agentPhoneSource,
          agentSourceOperator: agentOpSource,
          customerDestPhone: '+243' + phone,
          customerDestOperator: selectedOp,
          amount: curr === 'USD' ? amt * USD_RATE : amt,
          currencyOriginal: curr,
          amountOriginal: amt,
          fees: feesVal,
          totalDebited: totalUssdAmount,
          agentCommission: commVal,
          customerPhone: '+243' + phone,
          status: 'en_attente_ussd',
          createdAt: serverTimestamp()
        });

        if (isDepot) {
          window.showToast?.(`⏳ Push USSD envoyé sur votre téléphone Agent (${agentPhoneSource}). En attente de validation PIN...`, 'success');
          
          const { httpsCallable } = await import('./firebase.js');
          const functions = (await import('./firebase.js')).functions;

          const fpInRef = 'FP-IN-' + Date.now();
          let inRes = null;
          try {
            const payIn = httpsCallable(functions, 'payIn');
            inRes = await payIn({
              amount: String(amt),
              currency: curr,
              customerNumber: agentPhoneSource,
              method: agentOpSource,
              reference: fpInRef,
              description: `Collecte Agent Dépôt vers client +243${phone}`
            });
            if (inRes.data?.freshpayRef || inRes.data?.transactionId) {
              await updateDoc(txRef, { freshpayInRef: inRes.data?.freshpayRef || fpInRef });
            }
          } catch(payInErr) {
            console.error("Erreur initiation FreshPay PayIn:", payInErr);
          }

          const checkStatus = httpsCallable(functions, 'checkStatus');
          let payInSuccess = false;
          let failReason = '';

          if (inRes && inRes.data?.transactionId) {
            for (let i = 0; i < 12; i++) {
              await new Promise(r => setTimeout(r, 4000));
              try {
                const statusRes = await checkStatus({ reference: fpInRef, firestoreId: inRes.data?.firestoreId });
                const st = statusRes.data?.statut || statusRes.data?.transStatus || '';
                if (st === 'succès' || st === 'Successful' || st === 'success') {
                  payInSuccess = true;
                  break;
                } else if (st === 'échoué' || st === 'Failed' || st === 'failed') {
                  failReason = "Validation USSD refusée ou annulée par l'Agent.";
                  break;
                }
              } catch (e) {
                console.warn("Check status FreshPay:", e);
              }
            }
          } else {
            // En mode simulation ou si pas de transactionId, on simule le succès après 3s
            await new Promise(r => setTimeout(r, 3000));
            payInSuccess = true;
          }

          if (payInSuccess) {
            window.showToast?.(`⚡ Prélèvement Agent confirmé ! Déclenchement du versement vers le client (+243${phone})...`, 'success');
            await updateDoc(txRef, { status: 'en_cours_payout' });

            try {
              const payOut = httpsCallable(functions, 'payOut');
              const fpOutRef = 'FP-OUT-' + Date.now();
              const outRes = await payOut({
                amount: String(amt),
                currency: curr,
                beneficiaryNumber: '+243' + phone,
                method: selectedOp,
                reference: fpOutRef,
                beneficiaryName: 'Client Zola ' + phone
              });

              if (outRes.data && outRes.data.success) {
                await updateDoc(txRef, {
                  status: 'confirmed',
                  freshpayOutRef: fpOutRef,
                  confirmedAt: serverTimestamp()
                });

                const currentTotal = (agentData && agentData.commissions && agentData.commissions.total) || 0;
                const currentPending = (agentData && agentData.commissions && agentData.commissions.pending) || 0;
                const newTotal = currentTotal + commVal;
                const newPending = currentPending + commVal;

                await updateDoc(doc(db, 'agents', currentUser.uid), {
                  'commissions.total': newTotal,
                  'commissions.pending': newPending
                });
                if (!agentData.commissions) agentData.commissions = {};
                agentData.commissions.total = newTotal;
                agentData.commissions.pending = newPending;
                document.getElementById('kpiCommWeek').innerText = window.fmtCDF ? window.fmtCDF(newPending) : newPending + " CDF";
                document.getElementById('kpiTotalAll') && (document.getElementById('kpiTotalAll').innerText = window.fmtCDF ? window.fmtCDF(newTotal) : newTotal + " CDF");

                window.showToast?.(`🎉 Dépôt confirmé ! Versement de ${amt} ${curr} effectué vers le client (+243${phone}) et commission créditée !`, 'success');
              } else {
                throw new Error(outRes.data?.message || "Erreur de transfert Moko Africa / FreshPay vers le client.");
              }
            } catch(outErr) {
              await updateDoc(txRef, { status: 'failed', errorReason: outErr.message });
              window.showToast?.(`❌ Échec du versement vers le client : ${outErr.message}`, 'error');
            }
          } else {
            await updateDoc(txRef, { status: 'failed', errorReason: failReason || "Délai d'attente USSD Agent dépassé." });
            window.showToast?.(`❌ Échec de la transaction : ${failReason || "Le code PIN n'a pas été validé à temps."}`, 'error');
          }
        } else {
          // Retrait (Cash-Out)
          window.showToast?.(`⏳ Push USSD de ${totalUssdAmount} ${curr} (Montant + Frais) envoyé au client (+243${phone}). En attente de confirmation PIN...`, 'success');
          
          const { httpsCallable } = await import('./firebase.js');
          const functions = (await import('./firebase.js')).functions;

          const fpInRef = 'FP-IN-RET-' + Date.now();
          let inRes = null;
          try {
            const payIn = httpsCallable(functions, 'payIn');
            inRes = await payIn({
              amount: String(totalUssdAmount),
              currency: curr,
              customerNumber: '+243' + phone,
              method: selectedOp,
              reference: fpInRef,
              description: `Retrait Agent (${amt} ${curr} + ${feesVal} frais) - confirmation client +243${phone}`
            });
            if (inRes.data?.freshpayRef || inRes.data?.transactionId) {
              await updateDoc(txRef, { freshpayInRef: inRes.data?.freshpayRef || fpInRef });
            }
          } catch(payInErr) {
            console.error("Erreur initiation FreshPay PayIn Retrait:", payInErr);
          }

          const checkStatus = httpsCallable(functions, 'checkStatus');
          let payInSuccess = false;
          let failReason = '';

          if (inRes && inRes.data?.transactionId) {
            for (let i = 0; i < 12; i++) {
              await new Promise(r => setTimeout(r, 4000));
              try {
                const statusRes = await checkStatus({ reference: fpInRef, firestoreId: inRes.data?.firestoreId });
                const st = statusRes.data?.statut || statusRes.data?.transStatus || '';
                if (st === 'succès' || st === 'Successful' || st === 'success') {
                  payInSuccess = true;
                  break;
                } else if (st === 'échoué' || st === 'Failed' || st === 'failed') {
                  failReason = "Validation USSD refusée ou annulée par le client.";
                  break;
                }
              } catch (e) {
                console.warn("Check status FreshPay:", e);
              }
            }
          } else {
            await new Promise(r => setTimeout(r, 3000));
            payInSuccess = true;
          }

          if (payInSuccess) {
            window.showToast?.(`⚡ Retrait client confirmé ! Versement en cours sur votre compte Agent (${agentPhoneSource})...`, 'success');
            await updateDoc(txRef, { status: 'en_cours_payout' });

            try {
              const payOut = httpsCallable(functions, 'payOut');
              const fpOutRef = 'FP-OUT-RET-' + Date.now();
              const outRes = await payOut({
                amount: String(amt),
                currency: curr,
                beneficiaryNumber: agentPhoneSource,
                method: agentOpSource,
                reference: fpOutRef,
                beneficiaryName: 'Agent Zola ' + agentPhoneSource
              });

              if (outRes.data && outRes.data.success) {
                await updateDoc(txRef, {
                  status: 'confirmed',
                  freshpayOutRef: fpOutRef,
                  confirmedAt: serverTimestamp()
                });

                const currentTotal = (agentData && agentData.commissions && agentData.commissions.total) || 0;
                const currentPending = (agentData && agentData.commissions && agentData.commissions.pending) || 0;
                const newTotal = currentTotal + commVal;
                const newPending = currentPending + commVal;

                await updateDoc(doc(db, 'agents', currentUser.uid), {
                  'commissions.total': newTotal,
                  'commissions.pending': newPending
                });

                if (!agentData.commissions) agentData.commissions = {};
                agentData.commissions.total = newTotal;
                agentData.commissions.pending = newPending;
                document.getElementById('kpiCommWeek').innerText = window.fmtCDF ? window.fmtCDF(newPending) : newPending + " CDF";
                document.getElementById('kpiTotalAll') && (document.getElementById('kpiTotalAll').innerText = window.fmtCDF ? window.fmtCDF(newTotal) : newTotal + " CDF");

                window.showToast?.(`🎉 Retrait confirmé ! Payout de ${amt} ${curr} effectué vers votre compte Agent (${agentPhoneSource}) et commission créditée !`, 'success');
              } else {
                throw new Error(outRes.data?.message || "Erreur de versement Moko Africa / FreshPay vers le compte Agent.");
              }
            } catch(outErr) {
              await updateDoc(txRef, { status: 'failed', errorReason: outErr.message });
              window.showToast?.(`❌ Échec du versement vers le compte Agent : ${outErr.message}`, 'error');
            }
          } else {
            await updateDoc(txRef, { status: 'failed', errorReason: failReason || "Délai d'attente USSD client dépassé." });
            window.showToast?.(`❌ Échec de la transaction : ${failReason || "Le client n'a pas validé le code PIN à temps."}`, 'error');
          }
        }
      } catch(err) {
        console.error("Erreur lors de la transaction:", err);
        window.showToast?.("Erreur : " + (err.message || "Échec du traitement"), "error");
      } finally {
        txForm._isSubmitting = false;
        if(btn) { btn.disabled = false; btn.innerText = "Valider l'Opération"; }
      }
    });
  }

  // Settings form submit
  const settingsForm = document.getElementById('agentSettingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnSaveSettings');
      if (btn) { btn.disabled = true; btn.innerText = 'Enregistrement...'; }

      try {
        const { doc, updateDoc } = await import('./firebase.js');
        const db = (await import('./firebase.js')).db;
        const op = document.getElementById('settingMmOp')?.value || 'mpesa';
        const ph = document.getElementById('settingMmPhone')?.value || '';

        const fullPhone = '+243' + ph;
        await updateDoc(doc(db, 'agents', currentUser.uid), {
          selectedOperator: op,
          mmPhone: fullPhone,
          phone: fullPhone
        });

        if (agentData) {
          agentData.selectedOperator = op;
          agentData.mmPhone = fullPhone;
          agentData.phone = fullPhone;
        }

        let opDisplay = "M-Pesa";
        if (op === "airtel") opDisplay = "Airtel Money";
        else if (op === "orange") opDisplay = "Orange Money";
        else if (op === "afrimoney") opDisplay = "Afrimoney";

        const profMm = document.getElementById('profMmAccount');
        if (profMm) profMm.innerText = `${opDisplay} - ${fullPhone}`;

        window.showToast?.(`✅ Paramètres enregistrés ! Vos dépôts préleveront désormais le +243${ph} (${opDisplay}).`, 'success');
      } catch (err) {
        console.error("Erreur de sauvegarde paramètres:", err);
        window.showToast?.("Erreur lors de la sauvegarde", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.innerText = 'Enregistrer mes modifications'; }
      }
    });
  }

  // Identity & Photo update form submit
  const photoInput = document.getElementById('profilePhotoInput');
  if (photoInput) {
    photoInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 240;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
          } else {
            if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          
          window._tempProfilePhotoData = dataUrl;
          const circle = document.getElementById('profilePhotoCircle');
          if (circle) circle.innerHTML = `<img src="${dataUrl}" style="width:100%; height:100%; object-fit:cover;" />`;
          window.showToast?.("📸 Aperçu photo chargé. Cliquez sur 'Enregistrer mon Profil & Identité' pour confirmer.", "info");
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const identityForm = document.getElementById('agentIdentityForm');
  if (identityForm) {
    identityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnSaveIdentity');
      if (btn) { btn.disabled = true; btn.innerText = 'Enregistrement...'; }

      try {
        const { doc, updateDoc } = await import('./firebase.js');
        const db = (await import('./firebase.js')).db;
        const fullName = document.getElementById('settingFullName')?.value.trim() || '';
        const businessName = document.getElementById('settingBusinessName')?.value.trim() || '';
        const photoURL = window._tempProfilePhotoData || agentData?.photoURL || '';

        const parts = fullName.split(' ');
        const firstName = parts[0] || '';
        const lastName = parts.slice(1).join(' ') || '';

        const updatePayload = {
          firstName,
          lastName,
          businessName
        };
        if (photoURL) updatePayload.photoURL = photoURL;

        await updateDoc(doc(db, 'agents', currentUser.uid), updatePayload);

        if (agentData) {
          agentData.firstName = firstName;
          agentData.lastName = lastName;
          agentData.businessName = businessName;
          if (photoURL) agentData.photoURL = photoURL;
        }

        populateDashboard();
        window._tempProfilePhotoData = null;
        window.showToast?.("✨ Profil et identité Agent mis à jour avec succès !", "success");
      } catch (err) {
        console.error("Erreur update identité:", err);
        window.showToast?.("Erreur : " + err.message, "error");
      } finally {
        if (btn) { btn.disabled = false; btn.innerText = 'Enregistrer mon Profil & Identité'; }
      }
    });
  }

  const cardAmountInput = document.getElementById('cardAmount');
  const cardCurrencyInput = document.getElementById('cardCurrency');
  if (cardAmountInput) cardAmountInput.addEventListener('input', window.updateCardFeeBreakdown);
  if (cardCurrencyInput) cardCurrencyInput.addEventListener('change', window.updateCardFeeBreakdown);

  // Card Deposit form submit (Generate link & QR)
  const cardForm = document.getElementById('cardForm');
  if (cardForm) {
    cardForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const amt = parseFloat(document.getElementById('cardAmount')?.value) || 0;
      const curr = document.getElementById('cardCurrency')?.value || 'USD';
      const bank = document.getElementById('cardBank')?.value || 'Visa/Mastercard';

      if (amt <= 0) {
        window.showToast?.("Veuillez saisir un montant supérieur à 0.", "warning");
        return;
      }

      const fees = amt * 0.095;
      const total = (amt + fees).toFixed(2);
      const agentCode = (agentData && agentData.agentCode) || 'ZOLA-AG';
      
      const checkoutUrl = `https://zolamoneytransmarchand.web.app/cb_checkout.html?agent=${encodeURIComponent(agentCode)}&amt=${total}&baseAmt=${amt}&curr=${curr}&bank=${encodeURIComponent(bank)}&ref=CB_${Date.now()}`;
      
      const urlInput = document.getElementById('cardPaymentUrl');
      if (urlInput) urlInput.value = checkoutUrl;

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(checkoutUrl)}`;
      const qrCont = document.getElementById('cardQrContainer');
      if (qrCont) qrCont.innerHTML = `<img src="${qrUrl}" alt="QR Code Passerelle CB" style="width:160px;height:160px;display:block;margin:auto;" />`;

      const genArea = document.getElementById('cardGeneratedArea');
      if (genArea) genArea.style.display = 'block';

      window.showToast?.("⚡ Lien et QR Code Moko Africa générés ! Partagez au client.", "success");
    });
  }
});

window.resubmitAgentKyc = async function() {
  const btn = document.getElementById('resubmitBtnText');
  const spinner = document.getElementById('resubmitSpinner');
  
  const idInput = document.getElementById('resubmitIdDoc');
  const selfieInput = document.getElementById('resubmitSelfie');
  const shopInput = document.getElementById('resubmitShopPhoto');
  
  if (!idInput.files[0] && !selfieInput.files[0] && !shopInput.files[0]) {
    alert("Veuillez sélectionner au moins un document à corriger et resoumettre.");
    return;
  }
  
  if (btn) btn.style.display = 'none';
  if (spinner) spinner.style.display = 'inline-block';
  
  try {
    const uid = currentUser.uid;
    const uploadFile = async (fileInput, path) => {
      const file = fileInput.files[0];
      if (!file) return null;
      const fRef = storageRef(storage, `agents/${uid}/documents/resubmit_${path}_${Date.now()}_${file.name}`);
      await uploadBytes(fRef, file);
      return await getDownloadURL(fRef);
    };
    
    const newIdUrl = await uploadFile(idInput, 'id');
    const newSelfieUrl = await uploadFile(selfieInput, 'selfie');
    const newShopUrl = await uploadFile(shopInput, 'shop');
    
    const updatePayload = {
      status: 'pending',
      kycStatus: 'soumis',
      resubmittedAt: serverTimestamp(),
      kycRejectionReason: null
    };
    
    if (newIdUrl || newSelfieUrl || newShopUrl) {
      const currentDocs = agentData.documents || {};
      updatePayload.documents = {
        idDoc: newIdUrl || currentDocs.idDoc || null,
        selfie: newSelfieUrl || currentDocs.selfie || null,
        businessPhoto: newShopUrl || currentDocs.businessPhoto || null
      };
    }
    
    await updateDoc(doc(db, 'agents', uid), updatePayload);
    await updateDoc(doc(db, 'users', uid), {
      kycStatus: 'soumis',
      verified: false,
      status: 'pending',
      kycRejectionReason: null
    }).catch(() => {});
    
    alert("✅ Documents resoumis avec succès ! Votre dossier est de nouveau en cours de validation par notre équipe.");
    await loadAgentData();
  } catch(e) {
    console.error("Erreur resoumission KYC:", e);
    alert("Erreur lors de l'envoi : " + e.message);
  } finally {
    if (btn) btn.style.display = 'inline';
    if (spinner) spinner.style.display = 'none';
  }
};
