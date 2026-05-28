// js/kyc.js — Vérification KYC avec upload Firebase Storage LIVE
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const storage = getStorage();
window.handleLogout = async () => { await auth.signOut(); window.location.href = 'auth.html'; };

let currentStep = 3;
let uploadedFiles = {}; // { docFront: url, docBack: url, selfie: url }
let kycData = {};

window.triggerUpload = id => document.getElementById(id).click();

// ── Aperçu + upload Firebase Storage ──
window.previewUpload = async function(input, zoneId) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const zone = document.getElementById(zoneId);
  const user = auth.currentUser;
  if (!user) return;

  // Aperçu local immédiat
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      zone.innerHTML = `
        <img src="${e.target.result}" style="max-height:120px;border-radius:8px;object-fit:cover;" alt="Aperçu"/>
        <p style="margin-top:8px;font-size:0.8rem;color:var(--c-text2);">⬆️ Upload en cours…</p>
        <div class="progress-wrap" style="margin-top:8px;height:4px;background:var(--c-border);border-radius:4px;">
          <div id="progress-${zoneId}" style="height:100%;width:0%;background:var(--c-primary);border-radius:4px;transition:.3s;"></div>
        </div>`;
    };
    reader.readAsDataURL(file);
  } else {
    zone.innerHTML = `<p style="color:var(--c-text2);">⬆️ ${file.name} — Upload en cours…</p>`;
  }

  // Upload vers Firebase Storage
  try {
    const path = `kyc/${user.uid}/${zoneId}_${Date.now()}_${file.name}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, file);

    task.on('state_changed',
      snap => {
        const pct = (snap.bytesTransferred / snap.totalBytes * 100).toFixed(0);
        const bar = document.getElementById(`progress-${zoneId}`);
        if (bar) bar.style.width = pct + '%';
      },
      err => {
        console.error('[KYC Upload] Erreur:', err);
        zone.innerHTML = `<p style="color:var(--c-error);">❌ Erreur upload: ${err.message}</p>`;
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        uploadedFiles[zoneId] = url;
        const ext = file.name.split('.').pop();
        const isImg = ['jpg','jpeg','png','webp'].includes(ext.toLowerCase());
        zone.innerHTML = isImg
          ? `<img src="${url}" style="max-height:120px;border-radius:8px;object-fit:cover;" alt="Document"/><p style="margin-top:8px;font-size:.8rem;color:var(--c-success);">✅ ${file.name} — Uploadé</p>`
          : `<p style="color:var(--c-success);">✅ ${file.name} — Uploadé</p>`;
        showToast('Document uploadé avec succès', 'success');
      }
    );
  } catch(err) {
    console.error('[KYC] Upload error:', err);
    zone.innerHTML = `<p style="color:var(--c-error);">❌ Erreur : ${err.message}</p>`;
  }
};

window.submitStep = function(step) {
  if (step === 3) {
    const num = document.getElementById('idNumber').value.trim();
    const type = document.getElementById('idType')?.value || 'cni';
    if (!num) { showToast('Veuillez saisir le numéro du document.', 'error'); return; }
    kycData.idNumber = num;
    kycData.idType   = type;
    goToStep(4);
  } else if (step === 4) {
    goToStep(5);
  }
};

window.goToStep = function(step) {
  currentStep = step;
  [3,4,5].forEach(s => {
    const p = document.getElementById(`stepPanel${s}`);
    if (p) p.style.display = s === step ? '' : 'none';
  });
  document.querySelectorAll('.step').forEach((el, i) => {
    const s = i + 1;
    el.classList.remove('active','done');
    if (s < step) el.classList.add('done');
    else if (s === step) el.classList.add('active');
  });
  showToast(`Étape ${step}/5 — continuez la vérification`, 'info');
};

window.submitKYC = async function() {
  const rue   = document.getElementById('adresseRue')?.value.trim();
  const ville = document.getElementById('adresseVille')?.value.trim();
  if (!rue || !ville) { showToast('Veuillez remplir tous les champs d\'adresse.', 'error'); return; }

  kycData.adresse = { rue, ville };

  const submitBtn = document.querySelector('[onclick="submitKYC()"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Soumission…'; }

  const user = auth.currentUser;
  if (!user) { showToast('Session expirée. Reconnectez-vous.', 'error'); return; }

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      kycStatus:      'soumis',
      kycLevel:       'avance',
      kycDocuments:   uploadedFiles,
      kycData,
      adresse:        { rue, ville },
      kycSubmittedAt: serverTimestamp()
    });

    // Afficher panneau de confirmation
    [3,4,5].forEach(s => { const p = document.getElementById(`stepPanel${s}`); if(p) p.style.display='none'; });
    const done = document.getElementById('stepPanelDone');
    if (done) done.style.display = '';
    document.querySelectorAll('.step').forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
      const dot = el.querySelector('.step-dot');
      if (dot) dot.textContent = '✓';
    });
    showToast('🎉 Dossier KYC soumis avec succès ! Vérification sous 24-48h.', 'success');
  } catch(e) {
    console.error('[KYC] Submit error:', e);
    showToast('Erreur lors de la soumission : ' + e.message, 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Soumettre le dossier'; }
  }
};

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
});
