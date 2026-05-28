// js/mass_payment.js — Paiement en masse (Entreprise)
import { auth, db } from './firebase.js';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let currentUser = null;
let currentBatch = []; // [{ name, destination, method, amount }]

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const u = userSnap.data();
    const uType = u?.type || 'particulier';
    if (!userSnap.exists() || uType !== 'entreprise') {
      alert('Accès refusé. Cette page est réservée aux comptes Entreprise.');
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
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('loadingScreen').style.display = 'none';
  
  renderBatchTable();
});

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

// ── Ajout manuel d'un employé ──
window.addManualEmployee = function() {
  const name = document.getElementById('empName').value.trim();
  const dest = document.getElementById('empDest').value.trim();
  const method = document.getElementById('empMethod').value;
  const amount = parseFloat(document.getElementById('empAmount').value);

  if (!name || !dest || isNaN(amount) || amount <= 0) {
    if(window.showToast) window.showToast('Veuillez remplir tous les champs correctement.', 'error');
    else alert('Veuillez remplir tous les champs correctement.');
    return;
  }

  currentBatch.push({ name, destination: dest, method, amount });
  renderBatchTable();
  
  // reset form
  document.getElementById('empName').value = '';
  document.getElementById('empDest').value = '';
  document.getElementById('empAmount').value = '';
};

// ── Import CSV ──
window.handleCSVUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split('\n');
    let added = 0;
    
    // On suppose format: Nom,Destination,Methode,Montant
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length >= 4) {
        currentBatch.push({
          name: parts[0].trim(),
          destination: parts[1].trim(),
          method: parts[2].trim(),
          amount: parseFloat(parts[3].trim()) || 0
        });
        added++;
      }
    }
    renderBatchTable();
    if(window.showToast) window.showToast(`${added} employés importés avec succès.`, 'success');
    else alert(`${added} employés importés avec succès.`);
  };
  reader.readAsText(file);
};

// ── Rendu du tableau ──
window.removeEmployee = function(index) {
  currentBatch.splice(index, 1);
  renderBatchTable();
};

function renderBatchTable() {
  const tbody = document.getElementById('batchTableBody');
  const totalAmountEl = document.getElementById('totalAmount');
  const countEl = document.getElementById('batchCount');
  
  if (currentBatch.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--c-text3);">Aucun employé dans le lot actuel.</td></tr>`;
    if(totalAmountEl) totalAmountEl.textContent = '0 CDF';
    if(countEl) countEl.textContent = '0 employé(s)';
    return;
  }

  let total = 0;
  tbody.innerHTML = currentBatch.map((emp, index) => {
    total += emp.amount;
    return `
      <tr>
        <td>${emp.name}</td>
        <td>${emp.destination}</td>
        <td><span class="badge badge-info">${emp.method}</span></td>
        <td style="font-weight:bold;">${window.formatMoney ? window.formatMoney(emp.amount, 'CDF') : emp.amount}</td>
        <td style="text-align:right;">
          <button class="btn btn-outline btn-sm" onclick="removeEmployee(${index})">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if(totalAmountEl) totalAmountEl.textContent = window.formatMoney ? window.formatMoney(total, 'CDF') : total;
  if(countEl) countEl.textContent = `${currentBatch.length} employé(s)`;
}

// ── Soumission du lot ──
window.submitBatch = async function() {
  if (currentBatch.length === 0) {
    if(window.showToast) window.showToast('Le lot est vide.', 'error');
    else alert('Le lot est vide.');
    return;
  }

  const btn = document.getElementById('submitBatchBtn');
  btn.disabled = true;
  btn.textContent = 'Soumission...';

  try {
    const totalAmount = currentBatch.reduce((sum, emp) => sum + emp.amount, 0);
    const batchData = {
      userId: currentUser.uid,
      status: 'pending', // Attente de validation Maker/Checker
      totalAmount,
      employeeCount: currentBatch.length,
      employees: currentBatch,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'payment_batches'), batchData);
    
    currentBatch = [];
    renderBatchTable();
    if(window.showToast) window.showToast('Lot soumis avec succès pour validation !', 'success');
    else alert('Lot soumis avec succès pour validation !');
    
  } catch(e) {
    console.error(e);
    if(window.showToast) window.showToast('Erreur lors de la soumission.', 'error');
    else alert('Erreur lors de la soumission.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Soumettre le lot pour validation';
  }
};
