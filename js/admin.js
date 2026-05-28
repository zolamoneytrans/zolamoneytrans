import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut, db, collection, getDocs, doc, updateDoc, query, orderBy, limit } from './firebase.js';

const ADMIN_EMAIL = 'drnduwa@gmail.com';
let allUsers = [];
let selectedUser = null;

window.adminLogout = async () => { await signOut(auth); location.reload(); };

window.adminLogin = async function(e) {
  e.preventDefault();
  const email = document.getElementById('adminEmail').value;
  const pwd = document.getElementById('adminPwd').value;
  const btn = document.getElementById('adminLoginBtn');
  btn.disabled = true;
  btn.textContent = 'Connexion...';

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pwd);
    if (cred.user.email !== ADMIN_EMAIL) {
      await signOut(auth);
      showAdminAlert('Accès refusé.');
      btn.disabled = false;
      btn.textContent = 'Connexion';
      return;
    }
    document.getElementById('adminLogin').style.display = 'none';
    initAdmin(cred.user);
  } catch(err) {
    showAdminAlert(`Erreur: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Connexion';
  }
};

function showAdminAlert(msg) {
  const el = document.getElementById('adminAlert');
  el.style.display = 'block';
  el.textContent = msg;
}

async function initAdmin(user) {
  document.getElementById('adminSidebar').style.display = 'flex';
  document.getElementById('adminMain').style.display = 'flex';
  loadUsers();
}

async function loadUsers() {
  const listEl = document.getElementById('usersList');
  listEl.innerHTML = '<div style="padding:20px; text-align:center;">Chargement...</div>';
  try {
    const querySnapshot = await getDocs(collection(db, 'users'));
    allUsers = [];
    querySnapshot.forEach(docSnap => {
      allUsers.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderUsersList(allUsers);
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div style="padding:20px; color:red;">Erreur de chargement.</div>';
  }
}

function renderUsersList(users) {
  const listEl = document.getElementById('usersList');
  listEl.innerHTML = '';
  
  // Add a header item
  const header = document.createElement('div');
  header.style.padding = '8px 20px';
  header.style.fontSize = '0.8rem';
  header.style.color = 'var(--admin-text-light)';
  header.style.borderBottom = '1px solid var(--admin-border)';
  header.style.background = '#F8FAFC';
  header.textContent = 'Verified / Status';
  listEl.appendChild(header);

  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    if (selectedUser && selectedUser.id === u.id) div.classList.add('active');
    
    const isVerified = u.kycStatus === 'approuve' || u.verified === true;
    
    div.innerHTML = `
      <div class="user-item-name">${u.nom || u.prenom || 'Utilisateur inconnu'}</div>
      <div class="user-item-email">${u.email || u.telephone || ''}</div>
      <div style="font-size:0.75rem; margin-top:4px; color:${isVerified ? '#166534' : '#991B1B'}">
        ${isVerified ? '✅ Verified' : (u.kycStatus === 'soumis' ? '⏳ KYC Pending' : '❌ Unverified')}
      </div>
    `;
    div.onclick = () => selectUser(u);
    listEl.appendChild(div);
  });
}

window.filterUsersList = function(val) {
  const filtered = allUsers.filter(u => 
    (u.nom && u.nom.toLowerCase().includes(val.toLowerCase())) || 
    (u.email && u.email.toLowerCase().includes(val.toLowerCase()))
  );
  renderUsersList(filtered);
};

function selectUser(user) {
  selectedUser = user;
  renderUsersList(allUsers); // Update active state
  
  document.getElementById('noUserSelected').style.display = 'none';
  const panel = document.getElementById('userDetailPanel');
  panel.style.display = 'block';
  
  const isVerified = user.kycStatus === 'approuve' || user.verified === true;
  const verifiedBadge = isVerified ? `<span class="badge-verified">✅ Verified</span>` : `<span class="badge-unverified">❌ Unverified</span>`;
  
  const userPhoto = user.photoURL || user.avatar || (user.kycDocuments && user.kycDocuments.selfie) || null;
  const avatarHtml = userPhoto 
    ? `<img src="${userPhoto}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;"/>` 
    : `${(user.nom || user.email || 'U')[0].toUpperCase()}`;

  let kycDocsHtml = '';
  if (user.kycDocuments && Object.keys(user.kycDocuments).length > 0) {
    kycDocsHtml = `
      <div class="kyc-docs">
        <h3>KYC Documents</h3>
        <div class="docs-grid">
          ${user.kycDocuments.docFront ? `<div class="doc-card"><img src="${user.kycDocuments.docFront}" onclick="window.open('${user.kycDocuments.docFront}', '_blank')"/><div class="doc-label">ID Front</div></div>` : ''}
          ${user.kycDocuments.docBack ? `<div class="doc-card"><img src="${user.kycDocuments.docBack}" onclick="window.open('${user.kycDocuments.docBack}', '_blank')"/><div class="doc-label">ID Back</div></div>` : ''}
          ${user.kycDocuments.selfie ? `<div class="doc-card"><img src="${user.kycDocuments.selfie}" onclick="window.open('${user.kycDocuments.selfie}', '_blank')"/><div class="doc-label">Selfie</div></div>` : ''}
          ${user.kycDocuments.rccm ? `<div class="doc-card"><img src="${user.kycDocuments.rccm}" onclick="window.open('${user.kycDocuments.rccm}', '_blank')"/><div class="doc-label">RCCM</div></div>` : ''}
          ${user.kycDocuments.idNat ? `<div class="doc-card"><img src="${user.kycDocuments.idNat}" onclick="window.open('${user.kycDocuments.idNat}', '_blank')"/><div class="doc-label">ID Nat</div></div>` : ''}
          ${user.kycDocuments.statuts ? `<div class="doc-card"><img src="${user.kycDocuments.statuts}" onclick="window.open('${user.kycDocuments.statuts}', '_blank')"/><div class="doc-label">Statuts</div></div>` : ''}
        </div>
      </div>
    `;
  } else {
    kycDocsHtml = `
      <div class="kyc-docs">
        <h3>KYC Documents</h3>
        <p style="color:var(--admin-text-light); font-size:0.9rem;">No KYC documents uploaded.</p>
      </div>
    `;
  }
  
  const dateRecorded = user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
  
  panel.innerHTML = `
    <div class="user-profile-header">
      <div class="user-avatar-large" style="overflow:hidden;">${avatarHtml}</div>
      <div style="flex:1;">
        <div class="user-title-group">
          <h2>${user.nom || ''} ${user.postnom || ''}</h2>
          <p>${user.email || user.telephone || ''}</p>
        </div>
        <div class="badges">
          <span class="badge-role">${user.type || 'User'}</span>
          ${verifiedBadge}
          <button class="btn-toggle" onclick="toggleVerification('${user.id}', ${isVerified})">
            🛡️ Toggle Verification
          </button>
        </div>
      </div>
    </div>
    
    <h3 style="font-size:1.1rem; margin-bottom:20px; border-bottom:1px solid var(--admin-border); padding-bottom:8px;">User Information</h3>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-icon">👤</div>
        <div>
          <div class="info-label">Username</div>
          <div class="info-value">${user.nom || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">✉️</div>
        <div>
          <div class="info-label">Email</div>
          <div class="info-value">${user.email || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">📱</div>
        <div>
          <div class="info-label">Telephone</div>
          <div class="info-value">${user.telephone || user.phone || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">💰</div>
        <div>
          <div class="info-label">Balance</div>
          <div class="info-value">${user.balance || '0'} CDF</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">🎂</div>
        <div>
          <div class="info-label">Birthday</div>
          <div class="info-value">${user.kycData?.dateNaissance || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">⚧</div>
        <div>
          <div class="info-label">Gender</div>
          <div class="info-value">${user.genre || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">📍</div>
        <div>
          <div class="info-label">Ville</div>
          <div class="info-value">${user.adresse?.ville || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">🌍</div>
        <div>
          <div class="info-label">Pays</div>
          <div class="info-value">République Démocratique du Congo</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">🕒</div>
        <div>
          <div class="info-label">Date Recorded</div>
          <div class="info-value">${dateRecorded}</div>
        </div>
      </div>
      <div class="info-item">
        <div class="info-icon">🔑</div>
        <div>
          <div class="info-label">User ID</div>
          <div class="info-value" style="font-size:0.8rem;">${user.id}</div>
        </div>
      </div>
    </div>
    
    <div class="actions-footer">
      <button class="btn-outline">📝 Edit User</button>
      <button class="btn-outline">✉️ Send Email</button>
    </div>
    
    ${kycDocsHtml}
  `;
}

window.toggleVerification = async function(userId, currentlyVerified) {
  if (!confirm(`Are you sure you want to ${currentlyVerified ? 'revoke' : 'approve'} verification for this user?`)) return;
  
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      verified: !currentlyVerified,
      kycStatus: !currentlyVerified ? 'approuve' : 'rejete'
    });
    
    alert(`Verification ${currentlyVerified ? 'revoked' : 'approved'} successfully!`);
    
    // Update local state
    const uIndex = allUsers.findIndex(u => u.id === userId);
    if (uIndex > -1) {
      allUsers[uIndex].verified = !currentlyVerified;
      allUsers[uIndex].kycStatus = !currentlyVerified ? 'approuve' : 'rejete';
      selectUser(allUsers[uIndex]);
    }
  } catch (e) {
    console.error(e);
    alert('Error updating user: ' + e.message);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, user => {
    if (user && user.email === ADMIN_EMAIL) {
      document.getElementById('adminLogin').style.display = 'none';
      initAdmin(user);
    } else {
      document.getElementById('adminLogin').style.display = 'flex';
      document.getElementById('adminSidebar').style.display = 'none';
      document.getElementById('adminMain').style.display = 'none';
    }
  });
});

// --- Transactions Tab Logic ---
let allAdminTx = [];
let selectedTx = null;

window.showAdminTab = function(tabName) {
  document.getElementById('navUsers').classList.remove('active');
  document.getElementById('navTransactions').classList.remove('active');
  
  document.getElementById('tabUsers').style.display = 'none';
  document.getElementById('tabTransactions').style.display = 'none';
  
  if (tabName === 'users') {
    document.getElementById('navUsers').classList.add('active');
    document.getElementById('tabUsers').style.display = 'flex';
  } else if (tabName === 'transactions') {
    document.getElementById('navTransactions').classList.add('active');
    document.getElementById('tabTransactions').style.display = 'flex';
    if (allAdminTx.length === 0) loadAdminTransactions();
  }
};

async function loadAdminTransactions() {
  const listEl = document.getElementById('adminTxList');
  listEl.innerHTML = '<div style="padding:20px; text-align:center;">Loading...</div>';
  try {
    const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(500));
    const snap = await getDocs(q);
    allAdminTx = [];
    snap.forEach(d => allAdminTx.push({ id: d.id, ...d.data() }));
    renderAdminTxList(allAdminTx);
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div style="padding:20px; color:red;">Erreur de chargement.</div>';
  }
}

function renderAdminTxList(txList) {
  const listEl = document.getElementById('adminTxList');
  listEl.innerHTML = '';
  
  const header = document.createElement('div');
  header.style.padding = '8px 20px';
  header.style.fontSize = '0.8rem';
  header.style.color = 'var(--admin-text-light)';
  header.style.borderBottom = '1px solid var(--admin-border)';
  header.style.background = '#F8FAFC';
  header.textContent = 'Date / Info';
  listEl.appendChild(header);

  txList.forEach(tx => {
    const div = document.createElement('div');
    div.className = 'user-item';
    if (selectedTx && selectedTx.id === tx.id) div.classList.add('active');
    
    const dateVal = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
    const isSuccess = tx.statut === 'succès';
    const isFailed = tx.statut === 'échoué';
    let statusColor = '#EAB308'; // warning
    if (isSuccess) statusColor = '#10B981';
    if (isFailed) statusColor = '#EF4444';
    
    div.innerHTML = `
      <div class="user-item-name">${tx.beneficiaire || tx.customerNumber || 'Inconnu'}</div>
      <div class="user-item-email">${tx.montant} ${tx.currency || 'CDF'} • ${tx.type || 'Paiement'}</div>
      <div style="font-size:0.75rem; margin-top:4px; color:${statusColor}">
        ${tx.statut ? tx.statut.toUpperCase() : 'EN ATTENTE'} • ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(dateVal)}
      </div>
    `;
    div.onclick = () => selectTx(tx);
    listEl.appendChild(div);
  });
}

window.filterAdminTxList = function(val) {
  const lowVal = val.toLowerCase();
  const filtered = allAdminTx.filter(tx => 
    (tx.beneficiaire && tx.beneficiaire.toLowerCase().includes(lowVal)) || 
    (tx.reference && tx.reference.toLowerCase().includes(lowVal)) ||
    (tx.customerNumber && String(tx.customerNumber).includes(lowVal)) ||
    (tx.userEmail && tx.userEmail.toLowerCase().includes(lowVal))
  );
  renderAdminTxList(filtered);
};

function selectTx(tx) {
  selectedTx = tx;
  renderAdminTxList(allAdminTx);
  
  document.getElementById('noTxSelected').style.display = 'none';
  const panel = document.getElementById('adminTxDetailPanel');
  panel.style.display = 'block';
  
  const dateStr = tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString('fr-FR') : 'N/A';
  
  panel.innerHTML = `
    <div class="user-profile-header">
      <div class="user-avatar-large" style="background:#E2E8F0; color:#475569;">
        ${tx.action === 'credit' ? '↓' : '↑'}
      </div>
      <div style="flex:1;">
        <div class="user-title-group">
          <h2>${tx.montant} ${tx.currency || 'CDF'}</h2>
          <p>${tx.type || 'Transaction'}</p>
        </div>
        <div class="badges">
          <span class="badge-role">${tx.statut || 'N/A'}</span>
          <span class="badge-role" style="background:#F1F5F9;">Opérateur: ${tx.operateur || 'N/A'}</span>
        </div>
      </div>
    </div>
    
    <h3 style="font-size:1.1rem; margin-bottom:20px; border-bottom:1px solid var(--admin-border); padding-bottom:8px;">Transaction Details</h3>
    <div class="info-grid">
      <div class="info-item">
        <div>
          <div class="info-label">Reference ID</div>
          <div class="info-value" style="font-family:monospace; font-size:0.85rem;">${tx.reference || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div>
          <div class="info-label">Gateway Tx ID</div>
          <div class="info-value" style="font-family:monospace; font-size:0.85rem;">${tx.transactionId || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div>
          <div class="info-label">Date</div>
          <div class="info-value">${dateStr}</div>
        </div>
      </div>
    </div>
    
    <h3 style="font-size:1.1rem; margin-bottom:20px; border-bottom:1px solid var(--admin-border); padding-bottom:8px; margin-top:32px;">User Information</h3>
    <div class="info-grid">
      <div class="info-item">
        <div>
          <div class="info-label">User ID</div>
          <div class="info-value" style="font-size:0.8rem;">${tx.userId || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div>
          <div class="info-label">User Email</div>
          <div class="info-value">${tx.userEmail || 'N/A'}</div>
        </div>
      </div>
      <div class="info-item">
        <div>
          <div class="info-label">Beneficiary</div>
          <div class="info-value">${tx.beneficiaire || tx.customerNumber || 'N/A'}</div>
        </div>
      </div>
    </div>
    
    <div class="actions-footer">
      <button class="btn-outline">Copy Reference</button>
      <button class="btn-outline" style="color:red; border-color:#FECACA;">Flag Transaction</button>
    </div>
  `;
}

