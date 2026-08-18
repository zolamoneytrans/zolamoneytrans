// Zola Money APIs Administration scripts
import { db, functions, doc, getDoc, getDocs, setDoc, query, collection, where, onSnapshot, serverTimestamp, httpsCallable } from './firebase.js';

window.loadZolaApiClients = async function() {
  const tbody = document.getElementById('zolaApiClientsList');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Chargement...</td></tr>';
  
  try {
    const snap = await getDocs(collection(db, 'api_clients'));
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--admin-text-muted);">Aucun client API configur\u00E9.</td></tr>';
      return;
    }
    
    let html = '';
    snap.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : 'N/A';
      html += `
        <tr>
          <td><strong style="color:var(--c-light);">${data.name || 'N/A'}</strong></td>
          <td style="font-family:monospace; color:var(--c-gold); font-size:0.8rem;">${data.apiKey || 'N/A'}</td>
          <td style="font-size:0.8rem; max-width:200px; word-wrap:break-word;">${data.webhookUrl || 'Non d\u00E9finie'}</td>
          <td style="color:var(--c-danger); font-weight:bold;">${data.feePercentage || 0}%</td>
          <td>${data.payoutPhone || 'N/A'} (${data.payoutNetwork || 'N/A'})</td>
          <td>${data.autoPayout ? '<span class="status-badge success">Auto</span>' : '<span class="status-badge pending">Manuel</span>'}</td>
          <td>
            <button class="btn-premium outlined" style="padding:4px 8px; font-size:0.7rem;" onclick="window.zolaApiRegenerateKey('${doc.id}', '${data.name}')">R\u00E9g\u00E9n\u00E9rer Cl\u00E9</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (error) {
    console.error("Error loading Zola API clients:", error);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--c-danger);">Erreur de chargement.</td></tr>';
  }
};

window.zolaApiAddClient = async function(e) {
  e.preventDefault();
  const name = document.getElementById('zolaApiName').value.trim();
  const webhookUrl = document.getElementById('zolaApiWebhook').value.trim();
  const payoutPhone = document.getElementById('zolaApiPayoutPhone').value.trim();
  const payoutNetwork = document.getElementById('zolaApiPayoutNetwork').value;
  const feePercentage = parseFloat(document.getElementById('zolaApiFeePercentage').value) || 0;
  const autoPayout = document.getElementById('zolaApiAutoPayout').checked;
  const btn = document.getElementById('zolaApiAddBtn');
  
  if (!name) return;
  
  if(btn) {
    btn.disabled = true;
    btn.textContent = 'Cr\u00E9ation...';
  }
  
  try {
    const newKey = 'zola_live_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    
    await setDoc(doc(collection(db, 'api_clients')), {
      name,
      webhookUrl,
      payoutPhone,
      payoutNetwork,
      feePercentage,
      autoPayout,
      apiKey: newKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    if(typeof showAdminAlert === 'function') showAdminAlert("Client API ajout\u00E9 avec succ\u00E8s !", "success");
    document.getElementById('formAddZolaApiClient').reset();
    window.loadZolaApiClients();
  } catch (error) {
    console.error("Error creating Zola API client:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur lors de la cr\u00E9ation du client.", "error");
  } finally {
    if(btn) {
      btn.disabled = false;
      btn.textContent = 'Ajouter le Partenaire';
    }
  }
};

window.zolaApiRegenerateKey = async function(clientId, clientName) {
  if (!confirm(`Attention : R\u00E9g\u00E9n\u00E9rer la cl\u00E9 pour "${clientName}" invalidera l'ancienne. Continuer ?`)) {
    return;
  }
  try {
    const newKey = 'zola_live_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    await setDoc(doc(db, 'api_clients', clientId), {
      apiKey: newKey,
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    if(typeof showAdminAlert === 'function') showAdminAlert("Cl\u00E9 API r\u00E9g\u00E9n\u00E9r\u00E9e avec succ\u00E8s.", "success");
    window.loadZolaApiClients();
  } catch (error) {
    console.error("Error regenerating key:", error);
    if(typeof showAdminAlert === 'function') showAdminAlert("Erreur lors de la r\u00E9g\u00E9n\u00E9ration de la cl\u00E9 : " + error.message, "error");
  }
};

window.zolaApiApprovePayout = async function(transactionId) {
  if (!confirm("Approuver ce reversement Zola API et marquer comme pay\u00E9 ?")) {
    return;
  }
  try {
    if(typeof showAdminAlert === 'function') showAdminAlert("Approbation en cours...", "info");
    const approveFn = httpsCallable(functions, 'zolaApiApprovePayout');
    const result = await approveFn({ txId: transactionId });
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

window.loadZolaApiPendingPayouts = function() {
  const q = query(
    collection(db, 'transactions'),
    where('isZolaApi', '==', true),
    where('payout_status', '==', 'pending_admin_approval')
  );
  
  onSnapshot(q, snapshot => {
    const tbody = document.getElementById('zolaApiPendingPayoutsList');
    if (!tbody) return;
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--admin-text-muted);">Aucun reversement en attente.</td></tr>';
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
          <td><strong style="color:var(--c-light);">${tx.partnerName || 'Partenaire API'}</strong></td>
          <td style="font-family:monospace; color:var(--c-gold);">${tx.merchantReference || 'N/A'}</td>
          <td>${tx.montant} ${tx.currency || 'USD'}</td>
          <td style="color:var(--c-danger);">${feeAmount} ${tx.currency || 'USD'}</td>
          <td style="color:var(--c-success); font-weight:bold;">${netAmount} ${tx.currency || 'USD'}</td>
          <td>
            <button class="btn-premium primary" style="padding:4px 10px; font-size:0.75rem;" onclick="window.zolaApiApprovePayout('${doc.id}')">Approuver</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }, err => {
    console.error("Error loading pending Zola API payouts:", err);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('formAddZolaApiClient');
  if (form) {
    form.addEventListener('submit', window.zolaApiAddClient);
  }
});
