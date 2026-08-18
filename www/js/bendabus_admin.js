// Benda Bus API Administration scripts
import { db, functions, doc, getDoc, setDoc, query, collection, where, onSnapshot, serverTimestamp, httpsCallable } from './firebase.js';

window.loadBendaBusConfig = async function() {
  try {
    const docRef = doc(db, 'partners', 'bendabus');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById('bendabusApiKey').textContent = data.apiKey || 'Non d\u00E9finie';
      document.getElementById('bbPayoutPhone').value = data.payoutPhone || '';
      document.getElementById('bbPayoutNetwork').value = data.payoutNetwork || 'AIRTELMONEY';
      document.getElementById('bbAutoPayout').checked = data.autoPayout || false;
    } else {
      document.getElementById('bendabusApiKey').textContent = 'Configuration non initialis\u00E9e';
    }
  } catch (error) {
    console.error("Error loading Benda Bus config:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur de chargement de la configuration Benda Bus.", "error");
  }
};

window.bendabusSaveConfig = async function(e) {
  e.preventDefault();
  const phone = document.getElementById('bbPayoutPhone').value.trim();
  const network = document.getElementById('bbPayoutNetwork').value;
  const autoPayout = document.getElementById('bbAutoPayout').checked;
  const btn = document.getElementById('bbSaveConfigBtn');
  
  if(btn) {
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
  }
  
  try {
    await setDoc(doc(db, 'partners', 'bendabus'), {
      payoutPhone: phone,
      payoutNetwork: network,
      autoPayout: autoPayout,
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    if(typeof showAdminAlert === 'function') showAdminAlert("Configuration Benda Bus enregistr\u00E9e avec succ\u00E8s !", "success");
  } catch (error) {
    console.error("Error saving Benda Bus config:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur lors de l'enregistrement de la configuration.", "error");
  } finally {
    if(btn) {
      btn.disabled = false;
      btn.textContent = 'Enregistrer la Configuration';
    }
  }
};

window.bendabusRegenerateKey = async function() {
  if (!confirm("Attention : R\u00E9g\u00E9n\u00E9rer la cl\u00E9 invalidera l'ancienne. Benda Bus devra mettre \u00E0 jour sa configuration. Continuer ?")) {
    return;
  }
  try {
    const regenerateFn = httpsCallable(functions, 'bendabusRegenerateKey');
    const result = await regenerateFn();
    if (result.data && result.data.success) {
      document.getElementById('bendabusApiKey').textContent = result.data.newKey;
      if(typeof showAdminAlert === 'function') showAdminAlert("Cl\u00E9 API r\u00E9g\u00E9n\u00E9r\u00E9e avec succ\u00E8s.", "success");
    } else {
      throw new Error(result.data.error || 'Erreur inconnue');
    }
  } catch (error) {
    console.error("Error regenerating key:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur lors de la r\u00E9g\u00E9n\u00E9ration de la cl\u00E9 : " + error.message, "error");
  }
};

window.bendabusApprovePayout = async function(transactionId) {
  if (!confirm("Approuver ce reversement Benda Bus et marquer comme pay\u00E9 ?")) {
    return;
  }
  try {
    if(typeof showAdminAlert === 'function') showAdminAlert("Approbation en cours...", "info");
    const approveFn = httpsCallable(functions, 'bendabusApprovePayout');
    const result = await approveFn({ transactionId });
    if (result.data && result.data.success) {
      if(typeof showAdminAlert === 'function') showAdminAlert("Reversement approuv\u00E9 avec succ\u00E8s !", "success");
    } else {
      throw new Error(result.data.error || 'Erreur inconnue');
    }
  } catch (error) {
    console.error("Error approving payout:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur lors de l'approbation : " + error.message, "error");
  }
};

window.loadBendaBusPendingPayouts = function() {
  const q = query(
    collection(db, 'transactions'),
    where('isBendaBus', '==', true),
    where('payout_status', '==', 'pending_admin_approval')
  );
  
  onSnapshot(q, snapshot => {
    const tbody = document.getElementById('bbPendingPayoutsList');
    if (!tbody) return;
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--admin-text-muted);">Aucun reversement en attente.</td></tr>';
      return;
    }
    
    let html = '';
    snapshot.forEach(doc => {
      const tx = doc.data();
      const dateStr = tx.createdAt ? new Date(tx.createdAt.toDate()).toLocaleString() : 'N/A';
      const netAmount = tx.payoutAmount || 0;
      const feeAmount = tx.feeAmount || 0;
      
      html += `
        <tr>
          <td>${dateStr}</td>
          <td style="font-family:monospace; color:var(--c-gold);">${tx.merchantReference || 'N/A'}</td>
          <td>${tx.montant} ${tx.currency || 'USD'}</td>
          <td style="color:var(--c-danger);">${feeAmount} ${tx.currency || 'USD'}</td>
          <td style="color:var(--c-success); font-weight:bold;">${netAmount} ${tx.currency || 'USD'}</td>
          <td>
            <button class="btn-premium primary" style="padding:4px 10px; font-size:0.75rem;" onclick="window.bendabusApprovePayout('${doc.id}')">Approuver</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }, err => {
    console.error("Error loading pending Benda Bus payouts:", err);
  });
};

// Hook into tab changes to load data when BendaBus tab is opened
const originalShowAdminTab = window.showAdminTab;
window.showAdminTab = function(tabName) {
  if (typeof originalShowAdminTab === 'function') {
    originalShowAdminTab(tabName);
  }
  if (tabName === 'bendabus') {
    window.loadBendaBusConfig();
    window.loadBendaBusPendingPayouts();
  }
};
