// js/maker_checker.js — Validations (Maker/Checker) Entreprise
import { auth, db } from './firebase.js';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let currentUser = null;
let pendingBatches = [];

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
  
  loadPendingBatches();
});

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

async function loadPendingBatches() {
  const listEl = document.getElementById('batchesList');
  listEl.innerHTML = '<p style="text-align:center;color:var(--c-text3);padding:20px;">Chargement...</p>';
  
  try {
    const q = query(
      collection(db, 'payment_batches'),
      where('userId', '==', currentUser.uid),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );
    
    const snap = await getDocs(q);
    pendingBatches = [];
    snap.forEach(d => {
      pendingBatches.push({ id: d.id, ...d.data() });
    });
    
    renderBatches();
  } catch (e) {
    console.error('Erreur chargement lots:', e);
    listEl.innerHTML = '<p style="text-align:center;color:var(--c-danger);padding:20px;">Erreur de chargement des lots.</p>';
  }
}

function renderBatches() {
  const listEl = document.getElementById('batchesList');
  const countEl = document.getElementById('pendingCount');
  
  if(countEl) countEl.textContent = `${pendingBatches.length} lot(s)`;
  
  if (pendingBatches.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--c-text3);">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:0.5;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>Aucun lot en attente de validation.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = pendingBatches.map(batch => {
    const date = batch.createdAt?.toDate ? batch.createdAt.toDate().toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '—';
    
    const amt = window.formatMoney ? window.formatMoney(batch.totalAmount, 'CDF') : `${batch.totalAmount} CDF`;
    
    return `
      <div class="card" style="margin-bottom:16px; border:1px solid var(--c-border);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
          <div>
            <div style="font-weight:600; font-size:1.05rem; margin-bottom:4px;">Lot du ${date}</div>
            <div style="font-size:0.85rem; color:var(--c-text2);">${batch.employeeCount} employé(s) à payer</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700; color:var(--c-gold); font-size:1.1rem;">${amt}</div>
            <span class="badge badge-warning" style="margin-top:4px;">En attente</span>
          </div>
        </div>
        <div style="display:flex; gap:12px; margin-top:16px;">
          <button class="btn btn-outline" style="flex:1; border-color:var(--c-danger); color:var(--c-danger);" onclick="rejectBatch('${batch.id}')">Rejeter</button>
          <button class="btn btn-primary" style="flex:1;" onclick="approveBatch('${batch.id}')">Approuver & Payer</button>
        </div>
      </div>
    `;
  }).join('');
}

window.approveBatch = async function(batchId) {
  if(!confirm("Voulez-vous vraiment approuver et exécuter ce lot de paiements ?")) return;
  
  try {
    await updateDoc(doc(db, 'payment_batches', batchId), {
      status: 'approved',
      approvedAt: new Date()
    });
    if(window.showToast) window.showToast("Lot approuvé. Les paiements vont être traités.", "success");
    else alert("Lot approuvé.");
    loadPendingBatches(); // recharger la liste
  } catch(e) {
    console.error(e);
    if(window.showToast) window.showToast("Erreur lors de l'approbation.", "error");
  }
};

window.rejectBatch = async function(batchId) {
  if(!confirm("Voulez-vous rejeter ce lot de paiements ?")) return;
  
  try {
    await updateDoc(doc(db, 'payment_batches', batchId), {
      status: 'rejected',
      rejectedAt: new Date()
    });
    if(window.showToast) window.showToast("Lot rejeté.", "info");
    else alert("Lot rejeté.");
    loadPendingBatches(); // recharger la liste
  } catch(e) {
    console.error(e);
    if(window.showToast) window.showToast("Erreur lors du rejet.", "error");
  }
};
