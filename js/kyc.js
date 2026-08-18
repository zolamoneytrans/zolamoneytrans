// js/kyc.js — Vérification KYC avec upload Firebase Storage LIVE
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
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
  const donePanel = document.getElementById('stepPanelDone');
  if (donePanel) donePanel.style.display = 'none';
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
  const rue     = document.getElementById('adresseRue')?.value.trim();
  const commune = document.getElementById('adresseCommune')?.value.trim() || '';
  const ville   = document.getElementById('adresseVille')?.value.trim();
  if (!rue || !ville) { showToast('Veuillez remplir tous les champs d\'adresse.', 'error'); return; }

  kycData.adresse = { rue, commune, ville };

  const submitBtn = document.querySelector('[onclick="submitKYC()"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Soumission…'; }

  const user = auth.currentUser;
  if (!user) { showToast('Session expirée. Reconnectez-vous.', 'error'); return; }

  try {
    const kycDocs = {
      docFront: uploadedFiles['frontZone'] || '',
      docBack:  uploadedFiles['backZone'] || '',
      selfie:   uploadedFiles['selfieZone'] || '',
      proof:    uploadedFiles['proofZone'] || ''
    };

    await setDoc(doc(db, 'users', user.uid), {
      kycStatus:      'soumis',
      kycLevel:       'avance',
      kycDocuments:   kycDocs,
      kycData,
      adresse:        { rue, commune, ville },
      kycSubmittedAt: serverTimestamp()
    }, { merge: true });

    // Afficher panneau de confirmation
    const rejAlert = document.getElementById('kycRejectionAlert');
    if (rejAlert) rejAlert.style.display = 'none';
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
  if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }

  const userDocRef = doc(db, 'users', user.uid);
  onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      const profile = snap.data();
      const status = profile.kycStatus || 'non_initie';
      const level = profile.kycLevel || 'basique';

      // Update badges
      const badgeBasic = document.getElementById('badge-basic');
      const badgeAdvanced = document.getElementById('badge-advanced');
      const badgeMerchant = document.getElementById('badge-merchant');

      if (level === 'basique') {
        if (badgeBasic) { badgeBasic.textContent = 'Actif'; badgeBasic.className = 'badge badge-success'; }
        if (status === 'soumis') {
          if (badgeAdvanced) { badgeAdvanced.textContent = 'En examen'; badgeAdvanced.className = 'badge badge-warning'; }
        } else if (status === 'rejete') {
          if (badgeAdvanced) { badgeAdvanced.textContent = 'Refusé'; badgeAdvanced.className = 'badge badge-danger'; }
        } else {
          if (badgeAdvanced) { badgeAdvanced.textContent = 'Non complété'; badgeAdvanced.className = 'badge badge-info'; }
        }
      } else if (level === 'avance') {
        if (badgeBasic) { badgeBasic.textContent = 'Actif'; badgeBasic.className = 'badge badge-success'; }
        if (badgeAdvanced) { badgeAdvanced.textContent = 'Actif'; badgeAdvanced.className = 'badge badge-success'; }
        if (badgeMerchant) { badgeMerchant.textContent = 'Non complété'; badgeMerchant.className = 'badge badge-warning'; }
      } else if (level === 'marchand') {
        if (badgeBasic) { badgeBasic.textContent = 'Actif'; badgeBasic.className = 'badge badge-success'; }
        if (badgeAdvanced) { badgeAdvanced.textContent = 'Actif'; badgeAdvanced.className = 'badge badge-success'; }
        if (badgeMerchant) { badgeMerchant.textContent = 'Actif'; badgeMerchant.className = 'badge badge-success'; }
      }

      const rejAlert = document.getElementById('kycRejectionAlert');
      const donePanel = document.getElementById('stepPanelDone');

      // Check kycStatus
      if (status === 'soumis') {
        if (rejAlert) rejAlert.style.display = 'none';
        // Hide steps and forms
        [3, 4, 5].forEach(s => {
          const p = document.getElementById(`stepPanel${s}`);
          if (p) p.style.display = 'none';
        });
        const stepsBar = document.getElementById('kycStepsBar');
        if (stepsBar) stepsBar.style.display = 'none';
        
        if (donePanel) {
          donePanel.innerHTML = `
            <div style="font-size:4rem; margin-bottom:16px;">🎉</div>
            <h3 style="font-family:'Outfit',sans-serif; font-size:1.4rem; font-weight:800; margin-bottom:8px;">Dossier soumis avec succès !</h3>
            <p style="color:var(--c-text2); max-width:400px; margin:0 auto 24px;">Votre dossier KYC est en cours d'examen. La vérification prend généralement moins de 24 heures.</p>
            <span class="badge badge-warning" style="font-size:0.9rem; padding:8px 20px;">⏳ En cours de vérification</span>
            <div style="margin-top:24px;"><a href="dashboard.html" class="btn btn-primary">Retour au tableau de bord</a></div>
          `;
          donePanel.style.display = 'block';
        }
      } else if (status === 'approuve') {
        if (rejAlert) rejAlert.style.display = 'none';
        // Hide steps and forms
        [3, 4, 5].forEach(s => {
          const p = document.getElementById(`stepPanel${s}`);
          if (p) p.style.display = 'none';
        });
        const stepsBar = document.getElementById('kycStepsBar');
        if (stepsBar) stepsBar.style.display = 'none';
        
        if (donePanel) {
          donePanel.innerHTML = `
            <div style="font-size:4rem; margin-bottom:16px;">🛡️</div>
            <h3 style="font-family:'Outfit',sans-serif; font-size:1.4rem; font-weight:800; margin-bottom:8px; color:var(--c-success);">KYC Avancé Vérifié</h3>
            <p style="color:var(--c-text2); max-width:400px; margin:0 auto 24px;">Félicitations ! Votre identité a été vérifiée avec succès. Vous bénéficiez désormais de limites de transactions étendues.</p>
            <span class="badge badge-success" style="font-size:0.9rem; padding:8px 20px;">✅ Identité Vérifiée</span>
            <div style="margin-top:24px;"><a href="dashboard.html" class="btn btn-primary">Retour au tableau de bord</a></div>
          `;
          donePanel.style.display = 'block';
        }
      } else {
        // Normal form flow (non_initie, en_attente, rejete)
        if (donePanel) donePanel.style.display = 'none';
        
        const stepsBar = document.getElementById('kycStepsBar');
        if (stepsBar) stepsBar.style.display = 'flex';
        
        if (status === 'rejete' && rejAlert) {
          const motif = profile.kycReason || "Les documents soumis sont illisibles, expirés ou incomplets.";
          rejAlert.innerHTML = `
            <div class="alert alert-danger" style="display:flex; align-items:flex-start; gap:14px; margin-bottom:24px; padding:18px; border-radius:14px; background:rgba(239, 68, 68, 0.12); border:1px solid rgba(239, 68, 68, 0.4); color:#fff; text-align:left;">
              <div style="font-size:1.8rem; line-height:1;">❌</div>
              <div style="flex:1;">
                <h4 style="font-family:'Outfit',sans-serif; font-size:1.1rem; font-weight:800; color:#EF4444; margin-bottom:6px;">Vérification KYC Refusée</h4>
                <p style="font-size:0.9rem; color:#cbd5e1; margin-bottom:10px; line-height:1.4;">
                  Votre précédent dossier n'a pas pu être validé par notre équipe de conformité.<br>
                  <strong style="color:#fCA5A5;">Motif du refus :</strong> ${motif}
                </p>
                <div style="padding:10px 14px; background:rgba(255,255,255,0.05); border-radius:8px; font-size:0.85rem; color:#e2e8f0;">
                  ⚠️ Veuillez recharger des photos nettes et conformes ci-dessous pour soumettre à nouveau votre dossier.
                </div>
              </div>
            </div>
          `;
          rejAlert.style.display = 'block';
        } else if (rejAlert) {
          rejAlert.style.display = 'none';
        }
        
        goToStep(currentStep);
      }
    }
  });

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  const av = document.getElementById('userAvatar');
  if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
});
