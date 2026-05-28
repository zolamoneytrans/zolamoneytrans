// js/admin.js — Dashboard Administrateur Zola Money Trans
import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut, db, collection, getDocs, query, orderBy, limit } from './firebase.js';

const ADMIN_EMAIL = 'drnduwa@gmail.com';

window.handleLogout = window.adminLogout = async () => { await signOut(auth); location.reload(); };

// ── Auth ──
window.adminLogin = async function(e) {
  e.preventDefault();
  const email = document.getElementById('adminEmail').value;
  const pwd = document.getElementById('adminPwd').value;
  const btn = document.getElementById('adminLoginBtn');
  btn.disabled = true;
  document.getElementById('adminLoginSpin').style.display = '';
  document.getElementById('adminLoginTxt').style.display = 'none';

  // Mode démo local (sans Firebase) pour tests hors ligne
  if (email === ADMIN_EMAIL && pwd === 'ZolaAdmin2026!') {
    document.getElementById('adminLogin').style.display = 'none';
    initAdmin({ email: ADMIN_EMAIL, displayName: 'Dr. Nduwa', uid: 'demo-admin' });
    setTimeout(renderMerchantsTable, 100);
    setTimeout(renderAllTxTable, 100);
    btn.disabled = false;
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pwd);
    if (cred.user.email !== ADMIN_EMAIL) {
      await signOut(auth);
      showAdminAlert('Accès refusé. Ce compte ne dispose pas des droits administrateur.');
      btn.disabled = false;
      document.getElementById('adminLoginSpin').style.display = 'none';
      document.getElementById('adminLoginTxt').style.display = '';
      return;
    }
    document.getElementById('adminLogin').style.display = 'none';
    initAdmin(cred.user);
    setTimeout(renderMerchantsTable, 100);
    setTimeout(renderAllTxTable, 100);
  } catch(err) {
    showAdminAlert(`Identifiants incorrects. (${err.code})`);
    btn.disabled = false;
    document.getElementById('adminLoginSpin').style.display = 'none';
    document.getElementById('adminLoginTxt').style.display = '';
  }
};

function showAdminAlert(msg) {
  const el = document.getElementById('adminAlert');
  el.style.display = '';
  el.className = 'alert alert-danger';
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>${msg}`;
}

function initAdmin(user) {
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('adminShell').style.display = 'flex';
  document.getElementById('adminAvatar').textContent = (user.displayName || user.email || 'D')[0].toUpperCase();
  document.getElementById('adminName').textContent = user.displayName || 'Dr. Nduwa';
  document.getElementById('adminDateDisplay').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle:'full' }).format(new Date());
  buildCharts();
  renderAdminTxTable();
  renderUsersTable();
  renderAMLAlerts();
  renderMerchantsTable();
}

// ── Charts ──
function buildCharts() {
  const labels = Array.from({length:30},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-29+i); return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short'}).format(d); });
  const data = Array.from({length:30},()=>Math.floor(Math.random()*50+10));
  new Chart(document.getElementById('adminChart'), {
    type:'bar',
    data:{ labels, datasets:[{ label:'Transactions', data, backgroundColor:'rgba(124,58,237,0.6)', borderColor:'#7C3AED', borderWidth:1, borderRadius:4 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{color:'#A89FC0',maxTicksLimit:8}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#A89FC0'}} } }
  });
  new Chart(document.getElementById('opChart'), {
    type:'doughnut',
    data:{ labels:['M-Pesa','Airtel Money','Orange Money'], datasets:[{ data:[52,31,17], backgroundColor:['#e31e24','#FF4444','#FF6600'], borderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, cutout:'65%' }
  });
}

// ── Section navigation ──
window.showSection = function(name) {
  ['overview','users','transactions','aml','reports','merchants'].forEach(s => {
    const el = document.getElementById(`section-${s}`);
    if (el) el.style.display = s === name ? '' : 'none';
  });
  const titles = { overview:'Vue d\'ensemble', users:'Utilisateurs & KYC', transactions:'Toutes les transactions', aml:'Alertes AML/CFT', reports:'Rapports BCC', merchants:'Gestion Marchands' };
  document.getElementById('sectionTitle').textContent = titles[name] || name;
  document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
  event.currentTarget?.classList.add('active');
};

// ── Demo data ──
const DEMO_USERS = [
  { nom:'Jean Mukeba', email:'jean.mukeba@gmail.com', tel:'+243 812 345 678', type:'Marchand', kyc:'Avancé', date:'01/05/2026' },
  { nom:'Marie Lukusa', email:'marie.lukusa@outlook.com', tel:'+243 998 765 432', type:'Particulier', kyc:'Basique', date:'03/05/2026' },
  { nom:'Pierre Kabongo', email:'p.kabongo@proton.me', tel:'+243 851 234 567', type:'Entreprise', kyc:'En attente', date:'07/05/2026' },
  { nom:'Alpha Ngandu', email:'alpha@ngandu.cd', tel:'+243 820 111 222', type:'Marchand', kyc:'Marchand', date:'09/05/2026' },
  { nom:'Cécile Mwamba', email:'cecile.mwamba@yahoo.fr', tel:'+243 975 333 444', type:'Particulier', kyc:'Basique', date:'10/05/2026' },
];

const DEMO_TX_ALL = [
  { date:'13/05/2026 00:42', type:'Paiement QR', user:'Jean Mukeba', operateur:'M-Pesa', montant:45000, statut:'succès' },
  { date:'12/05/2026 23:15', type:'Transfert', user:'Marie Lukusa', operateur:'Airtel Money', montant:120000, statut:'succès' },
  { date:'12/05/2026 21:00', type:'Facture SNEL', user:'Pierre Kabongo', operateur:'Orange Money', montant:22000, statut:'succès' },
  { date:'12/05/2026 18:30', type:'Paiement QR', user:'Alpha Ngandu', operateur:'M-Pesa', montant:875000, statut:'en attente' },
  { date:'12/05/2026 15:00', type:'Transfert', user:'Cécile Mwamba', operateur:'Airtel Money', montant:38000, statut:'échoué' },
  { date:'12/05/2026 12:10', type:'Paiement QR', user:'Jean Mukeba', operateur:'M-Pesa', montant:67500, statut:'succès' },
];

const DEMO_MERCHANTS = [
  { nom:'Boutique Mapendo', contact:'Jean Mukeba', tel:'+243 812 345 678', kyc:'Marchand', txMois:128, volume:'2 345 000 FC', statut:'Actif' },
  { nom:'Restaurant Chez Mama', contact:'Claudine Tshimanga', tel:'+243 899 012 345', kyc:'Avancé', txMois:87, volume:'1 875 000 FC', statut:'Actif' },
  { nom:'Pharmacie Centrale', contact:'Dr. Robert Mfumu', tel:'+243 972 456 789', kyc:'Marchand', txMois:215, volume:'5 620 000 FC', statut:'Actif' },
];

const DEMO_AML = [
  { id:'AML-001', date:'12/05/2026 23:40', user:'Alpha Ngandu', montant:875000, motif:'Transaction > 2 000 USD. Profil inhabituel.', niveau:'critique', statut:'En attente' },
  { id:'AML-002', date:'11/05/2026 14:22', user:'Pierre Kabongo', montant:450000, motif:'3 transactions rapprochées en moins d\'1 heure.', niveau:'modéré', statut:'En cours' },
  { id:'AML-003', date:'10/05/2026 09:15', user:'Inconnu-Ref-7X', montant:310000, motif:'Numéro bénéficiaire sur liste sanctions OFAC.', niveau:'critique', statut:'Signalé CENAREF' },
];

function kycBadge(k) {
  const m = { 'Marchand':'warning','Avancé':'info','Basique':'success','En attente':'danger' };
  return `<span class="badge badge-${m[k]||'primary'}">${k}</span>`;
}
function statusBadge(s) {
  const m = { 'succès':'success','en attente':'warning','échoué':'danger','Actif':'success' };
  return `<span class="badge badge-${m[s]||'info'}">${s}</span>`;
}

function renderAdminTxTable() {
  document.getElementById('adminTxTable').innerHTML = buildTxTableHTML(DEMO_TX_ALL.slice(0,5));
}

function renderAllTxTable() {
  const el = document.getElementById('allTxTable');
  if(el) el.innerHTML = buildTxTableHTML(DEMO_TX_ALL);
}

function buildTxTableHTML(txs) {
  return `<table><thead><tr><th>Date</th><th>Type</th><th>Utilisateur</th><th>Opérateur</th><th>Montant (CDF)</th><th>Statut</th></tr></thead>
  <tbody>${txs.map(t=>`<tr><td style="font-size:0.8rem;color:var(--c-text2);">${t.date}</td><td>${t.type}</td><td>${t.user}</td><td>${t.operateur}</td><td style="font-family:'Outfit',sans-serif;font-weight:700;">${window.fmtCDF(t.montant)}</td><td>${statusBadge(t.statut)}</td></tr>`).join('')}</tbody></table>`;
}

function renderUsersTable() {
  document.getElementById('usersTableBody').innerHTML = DEMO_USERS.map(u=>`
    <tr>
      <td><div style="display:flex;align-items:center;gap:10px;"><div class="avatar" style="width:32px;height:32px;font-size:0.8rem;">${u.nom[0]}</div><strong>${u.nom}</strong></div></td>
      <td style="font-size:0.82rem;">${u.email}</td>
      <td style="font-size:0.82rem;">${u.tel}</td>
      <td><span class="badge badge-primary">${u.type}</span></td>
      <td>${kycBadge(u.kyc)}</td>
      <td style="font-size:0.8rem;color:var(--c-text2);">${u.date}</td>
      <td><button class="btn btn-outline btn-sm" onclick="window.showToast('Profil ouvert : ${u.nom}','info')">Voir</button></td>
    </tr>`).join('');
}

function renderAMLAlerts() {
  document.getElementById('amlAlertsList').innerHTML = DEMO_AML.map(a=>`
    <div class="card" style="margin-bottom:16px; border-left:4px solid ${a.niveau==='critique'?'var(--c-danger)':'var(--c-warning)'};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <span class="badge ${a.niveau==='critique'?'badge-danger':'badge-warning'}">${a.niveau.toUpperCase()}</span>
            <strong style="font-size:0.9rem;">${a.id}</strong>
            <span style="font-size:0.8rem;color:var(--c-text3);">${a.date}</span>
          </div>
          <div style="font-size:0.88rem; margin-bottom:6px;"><strong>Utilisateur :</strong> ${a.user} &nbsp;|&nbsp; <strong>Montant :</strong> ${window.fmtCDF(a.montant)}</div>
          <div style="font-size:0.85rem;color:var(--c-text2);">⚠️ ${a.motif}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;min-width:140px;">
          ${statusBadge(a.statut)}
          <button class="btn btn-danger btn-sm" onclick="signalCENAREF('${a.id}')">Signaler CENAREF</button>
          <button class="btn btn-outline btn-sm" onclick="resolveAML('${a.id}')">Clore l'alerte</button>
        </div>
      </div>
    </div>`).join('');
}

function renderMerchantsTable() {
  const el = document.getElementById('merchantsTable');
  if (!el) return;
  el.innerHTML = `<table><thead><tr><th>Commerce</th><th>Contact</th><th>Téléphone</th><th>KYC</th><th>Tx / Mois</th><th>Volume</th><th>Statut</th><th>Actions</th></tr></thead>
  <tbody>${DEMO_MERCHANTS.map(m=>`<tr>
    <td><strong>${m.nom}</strong></td>
    <td>${m.contact}</td>
    <td style="font-size:0.82rem;">${m.tel}</td>
    <td>${kycBadge(m.kyc)}</td>
    <td style="font-weight:700;">${m.txMois}</td>
    <td style="font-family:'Outfit',sans-serif;">${m.volume}</td>
    <td>${statusBadge(m.statut)}</td>
    <td><button class="btn btn-outline btn-sm" onclick="window.showToast('Fiche marchand : ${m.nom}','info')">Voir</button></td>
  </tr>`).join('')}</tbody></table>`;
}

window.filterUsers = function(val) {
  const rows = document.querySelectorAll('#usersTableBody tr');
  rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(val.toLowerCase()) ? '' : 'none'; });
};

window.signalCENAREF = function(id) { window.showToast(`🏛️ Alerte ${id} signalée au CENAREF`, 'info'); };
window.resolveAML = function(id) { window.showToast(`✅ Alerte ${id} clôturée`, 'success'); };
window.genReport = function(type) { window.showToast(`📄 Rapport "${type}" en cours de génération...`, 'info'); };

window.exportAllCSV = function() {
  const rows = ['Date,Type,Utilisateur,Opérateur,Montant CDF,Statut', ...DEMO_TX_ALL.map(t=>`${t.date},${t.type},${t.user},${t.operateur},${t.montant},${t.statut}`)];
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(rows.join('\n'));
  a.download = `zola-admin-transactions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  window.showToast('Export CSV téléchargé !', 'success');
};

// ── Auth check — montrer le formulaire login immédiatement ──
// Masquer le loading screen dès le départ pour éviter un blocage
document.addEventListener('DOMContentLoaded', () => {
  // Petit délai pour laisser Firebase s'initialiser, puis afficher login si non connecté
  const safetyTimer = setTimeout(() => {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('adminLogin').style.display = 'flex';
  }, 3000);

  onAuthStateChanged(auth, user => {
    clearTimeout(safetyTimer);
    document.getElementById('loadingScreen').style.display = 'none';
    if (!user || user.email !== ADMIN_EMAIL) {
      if (user) signOut(auth);
      document.getElementById('adminLogin').style.display = 'flex';
      return;
    }
    document.getElementById('adminLogin').style.display = 'none';
    initAdmin(user);
    setTimeout(renderMerchantsTable, 100);
    setTimeout(renderAllTxTable, 100);
  });
});
