// js/dashboard_eglise.js — Church Dashboard Logic
// Zola Money Trans

import { auth, db, signOut } from './firebase.js';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const storage = getStorage();

let currentUser = null;
let uploadedFiles = {}; // { pastorIdZone: url, churchDocZone: url, churchLogoZone: url }

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }
  
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const u = userSnap.data();
    if (userSnap.exists() && u.blocked === true) {
      await signOut(auth);
      window.location.href = 'auth.html';
      return;
    }
    if (!userSnap.exists() || u.type !== 'eglise') {
      alert('Accès refusé. Cette page est réservée aux Églises / Ministères.');
      window.location.href = 'dashboard.html';
      return;
    }

    currentUser = user;
    if (window.checkAndShowKycReminder) window.checkAndShowKycReminder(u);
    const av = document.getElementById('userAvatar');
    if (av) av.textContent = (user.displayName || u.prenom || 'E')[0].toUpperCase();
    
    document.getElementById('userName').textContent = `${u.prenom || ''} ${u.nom || ''}`;
    document.getElementById('userInfo').style.display = 'flex';

    // Watch KYC Status
    onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const profile = docSnap.data();
        const status = profile.kycStatus || 'non_initie';

        document.getElementById('kycFormSection').style.display = 'none';
        document.getElementById('kycPendingSection').style.display = 'none';
        document.getElementById('dashboardSection').style.display = 'none';

        const rejAlert = document.getElementById('egliseRejectionAlert');
        if (rejAlert) rejAlert.style.display = 'none';

        if (status === 'non_initie' || status === 'en_attente' || status === 'rejete') {
          document.getElementById('kycFormSection').style.display = 'block';
          if (status === 'rejete' && rejAlert) {
            const motif = profile.kycReason || "Dossier ou justificatifs non conformes.";
            rejAlert.innerHTML = `
              <div class="alert alert-danger" style="margin-bottom:20px; padding:16px; border-radius:12px; background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.4); color:#fff; display:flex; gap:12px; align-items:flex-start;">
                <span style="font-size:1.6rem;">❌</span>
                <div>
                  <h4 style="font-weight:700; color:#EF4444; margin-bottom:4px;">Dossier Église Refusé</h4>
                  <p style="font-size:0.88rem; color:#cbd5e1; margin:0;">Motif : ${motif}<br>Veuillez soumettre à nouveau vos informations corrigées.</p>
                </div>
              </div>
            `;
            rejAlert.style.display = 'block';
          }
        } else if (status === 'soumis') {
          document.getElementById('kycPendingSection').style.display = 'block';
        } else if (status === 'approuve') {
          document.getElementById('dashboardSection').style.display = 'block';
          
          // Populate Dashboard Details
          if (profile.kycData) {
            document.getElementById('dashChurchName').textContent = profile.kycData.churchName || '—';
            document.getElementById('dashChurchPhone').textContent = profile.kycData.churchPhone || '—';
            document.getElementById('dashMomoAccount').textContent = profile.kycData.momoAccount || '—';
          }
          document.getElementById('dashPastorName').textContent = `${profile.prenom || ''} ${profile.nom || ''}`;

          generateStaticQR(user.uid, profile.kycData?.churchName);
          loadTodayTransactions(user.uid);
        }
      }
    });

  } catch (e) {
    console.error("Error fetching user profile", e);
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('appShell').style.display = '';
  document.getElementById('loadingScreen').style.display = 'none';
});

// --- KYC Upload Logic ---

window.previewChurchUpload = async function(input, zoneId) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const zone = document.getElementById(zoneId);
  const user = auth.currentUser;
  if (!user) return;

  // Visual feedback
  const originalHtml = zone.innerHTML;
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      zone.innerHTML = `<img src="${e.target.result}" style="max-height:80px;border-radius:8px;object-fit:cover;" alt="Aperçu"/><p style="font-size:0.8rem;color:var(--c-text2);">Upload...</p>`;
    };
    reader.readAsDataURL(file);
  } else {
    zone.innerHTML = `<p style="font-size:0.8rem;color:var(--c-text2);">Upload ${file.name}...</p>`;
  }

  try {
    const path = `kyc_eglise/${user.uid}/${zoneId}_${Date.now()}_${file.name}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, file);

    task.on('state_changed', null, 
      (err) => {
        console.error(err);
        zone.innerHTML = `<p style="color:var(--c-error);">❌ Erreur: ${err.message}</p>`;
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        uploadedFiles[zoneId] = url;
        const ext = file.name.split('.').pop();
        const isImg = ['jpg','jpeg','png','webp'].includes(ext.toLowerCase());
        zone.innerHTML = isImg 
          ? `<img src="${url}" style="max-height:80px;border-radius:8px;object-fit:cover;" alt="Doc"/><p style="font-size:.8rem;color:var(--c-success);">✅ Uploadé</p>`
          : `<p style="color:var(--c-success);">✅ ${file.name} Uploadé</p>`;
        showToast('Document uploadé', 'success');
      }
    );
  } catch (err) {
    zone.innerHTML = `<p style="color:var(--c-error);">❌ ${err.message}</p>`;
  }
};

window.submitChurchKyc = async function(e) {
  e.preventDefault();
  
  if (!uploadedFiles['pastorIdZone']) {
    showToast('L\'ID du Pasteur est requis.', 'error'); return;
  }
  if (!uploadedFiles['churchDocZone']) {
    showToast('Le document de l\'Église est requis.', 'error'); return;
  }

  const kycData = {
    churchName: document.getElementById('churchName').value.trim(),
    churchPhone: document.getElementById('churchPhone').value.trim(),
    churchAddress: document.getElementById('churchAddress').value.trim(),
    momoAccount: document.getElementById('momoAccount').value.trim()
  };

  const btn = document.getElementById('submitKycBtn');
  btn.disabled = true; btn.textContent = 'Soumission en cours...';

  try {
    const kycDocs = {
      pastorId: uploadedFiles['pastorIdZone'],
      churchDoc: uploadedFiles['churchDocZone'],
      churchLogo: uploadedFiles['churchLogoZone'] || ''
    };

    await setDoc(doc(db, 'users', currentUser.uid), {
      kycStatus: 'soumis',
      kycDocuments: kycDocs,
      kycData: kycData,
      kycSubmittedAt: serverTimestamp()
    }, { merge: true });

    showToast('Dossier soumis avec succès !', 'success');
  } catch (err) {
    console.error(err);
    showToast('Erreur lors de la soumission: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Soumettre pour vérification';
  }
};

// --- Dashboard Logic ---

function generateStaticQR(uid, churchName) {
  // Point to pay.html to the church's UID
  const payLink = `${location.origin}/smart_pay.html?to=${uid}`;
  document.getElementById('churchPayLink').textContent = payLink;
  
  const box = document.getElementById('churchStaticQR');
  box.innerHTML = '';
  new QRCode(box, { 
    text: payLink, 
    width: 220, 
    height: 220, 
    colorDark: '#7C3AED', 
    colorLight: '#ffffff', 
    correctLevel: QRCode.CorrectLevel.H 
  });
}

window.downloadQR = function(id, name) {
  const box = document.getElementById(id);
  if (!box) { showToast('Générez d\'abord le QR code', 'error'); return; }
  
  let dataUrl = '';
  const img = box.querySelector('img');
  if (img && img.src && img.src.startsWith('data:image')) {
    dataUrl = img.src;
  } else {
    const canvas = box.querySelector('canvas');
    if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    }
  }
  
  if (!dataUrl) {
    showToast('Erreur: Image QR introuvable', 'error');
    return;
  }
  
  const printWrapper = document.createElement('div');
  printWrapper.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 794px; height: 1123px; z-index: -99999; background: #ffffff; overflow: hidden;';

  const container = document.createElement('div');
  container.style.cssText = 'width: 794px; height: 1123px; max-height: 1123px; padding: 40px 36px; background-color: #ffffff; color: #1e1e2d; font-family: Arial, sans-serif; text-align: center; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; margin: 0; overflow: hidden;';
  
  container.innerHTML = `
    <div style="border: 3px solid #7C3AED; border-radius: 24px; padding: 36px 28px; background: #ffffff; box-shadow: 0 10px 30px rgba(124,58,237,0.08); box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;">
      <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 10px;">
        <img src="icons/zolalogo192x192.png" alt="Zola Money" style="height: 60px;" />
        <div style="text-align: left; line-height: 1.1;">
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">ZOLA</div>
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">MONEY</div>
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">TRANS</div>
          <div style="color: #7C3AED; font-weight: 800; font-size: 24px;">SERVICE</div>
          <div style="color: #64748b; font-size: 10px; margin-top: 4px; letter-spacing: 1px;">RAPIDE & SÉCURISÉ</div>
        </div>
      </div>
      <h1 style="color: #2D1B69; font-size: 32px; margin-bottom: 20px; font-weight: bold;">Scannez pour donner</h1>
      
      <div id="qr-placeholder" style="background: #ffffff; padding: 20px; border-radius: 20px; border: 4px solid #7C3AED; margin: 0 auto 20px auto; width: 260px; height: 260px; display: flex; justify-content: center; align-items: center;">
        <img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />
      </div>
      
      <p style="font-weight: 600; font-size: 20px; color: #1e1e2d; margin-bottom: 20px;">Don sécurisé avec <span style="font-weight: 800;">ZolaMoneyTrans</span></p>
      
      <div style="display: flex; justify-content: center; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;">
        <div style="background: #FF0000; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">airtel <span style="font-weight: normal; font-size: 12px;">money</span></div>
        <div style="background: #FF6600; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">orange <span style="font-weight: normal; font-size: 12px;">money</span></div>
        <div style="background: #00A651; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">M-PESA</div>
        <div style="background: #6D28D9; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">afri <span style="font-weight: normal; font-size: 12px;">money</span></div>
      </div>
      
      <div style="background: #2D1B69; color: white; padding: 20px; border-radius: 16px; margin-top: 10px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 15px;">
        <div style="border: 2px solid white; border-radius: 12px; padding: 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <div style="text-align: left;">
          <div style="font-size: 18px; font-weight: bold; margin-bottom: 6px;">Sûr, rapide et sans stress.</div>
          <div style="color: #FBBF24; font-size: 20px; font-weight: bold;">Donnez en toute confiance !</div>
        </div>
      </div>
    </div>
  `;

  printWrapper.appendChild(container);
  document.body.appendChild(printWrapper);

  if (typeof html2pdf !== 'undefined') {
    const opt = {
      margin:       0,
      filename:     name + '.pdf',
      image:        { type: 'jpeg', quality: 0.99 },
      html2canvas:  { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: 1200 },
      jsPDF:        { unit: 'px', format: [794, 1123], orientation: 'portrait' }
    };
    html2pdf().set(opt).from(container).save().then(() => {
      if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
      showToast('PDF téléchargé avec succès', 'success');
    }).catch(err => {
      if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
      console.error(err);
    });
  } else {
    // Fallback
    const a = document.createElement('a');
    a.download = name + '.png';
    a.href = dataUrl;
    a.click();
    showToast('Image téléchargée avec succès', 'success');
  }
};

window.generateCustomQR = function() {
  const motif = document.getElementById('campaignMotif').value.trim();
  const amount = document.getElementById('campaignAmount').value.trim();
  const currency = document.getElementById('campaignCurrency').value;

  if (!motif || !amount) {
    showToast('Veuillez entrer un motif et un montant.', 'error');
    return;
  }

  const payLink = `${location.origin}/smart_pay.html?to=${auth.currentUser.uid}&amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(currency)}&desc=${encodeURIComponent(motif)}`;
  
  const box = document.getElementById('campaignStaticQR');
  box.innerHTML = '';
  new QRCode(box, { 
    text: payLink, 
    width: 200, 
    height: 200, 
    colorDark: '#7C3AED', 
    colorLight: '#ffffff', 
    correctLevel: QRCode.CorrectLevel.H 
  });

  document.getElementById('campaignQRSection').style.display = 'flex';
  showToast('QR Code de campagne généré !', 'success');
};

window.downloadCustomQR = function() {
  const motif = document.getElementById('campaignMotif').value.trim();
  const amount = document.getElementById('campaignAmount').value.trim();
  const currency = document.getElementById('campaignCurrency').value;

  if (!motif || !amount) {
    showToast('Campagne invalide.', 'error'); return;
  }

  const box = document.getElementById('campaignStaticQR');
  let dataUrl = '';
  const img = box.querySelector('img');
  if (img && img.src && img.src.startsWith('data:image')) {
    dataUrl = img.src;
  } else {
    const canvas = box.querySelector('canvas');
    if (canvas) dataUrl = canvas.toDataURL('image/png');
  }
  
  if (!dataUrl) { showToast('Générez d\'abord le QR code', 'error'); return; }

  const printWrapper = document.createElement('div');
  printWrapper.id = 'printWrapper_eglise';
  printWrapper.style.cssText = 'position: absolute; left: 0; top: 0; width: 794px; height: 1123px; z-index: -999999; background: #ffffff; opacity: 0; pointer-events: none; overflow: hidden; margin: 0; padding: 0; border: none;';

  const container = document.createElement('div');
  container.style.cssText = 'position: absolute; left: 0; top: 0; width: 794px; height: 1123px; max-height: 1123px; padding: 40px 36px; background-color: #ffffff; color: #1e1e2d; font-family: Arial, sans-serif; text-align: center; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; margin: 0; overflow: hidden;';
  
  const formattedAmount = window.formatMoney ? window.formatMoney(amount, currency) : amount + ' ' + currency;

  container.innerHTML = `
    <div style="border: 3px solid #7C3AED; border-radius: 24px; padding: 36px 28px; background: #ffffff; box-shadow: 0 10px 30px rgba(124,58,237,0.08); box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;">
      <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 10px;">
        <img src="icons/zolalogo192x192.png" alt="Zola Money" style="height: 60px;" />
        <div style="text-align: left; line-height: 1.1;">
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">ZOLA</div>
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">MONEY</div>
          <div style="color: #e31e24; font-weight: 800; font-size: 24px;">TRANS</div>
          <div style="color: #7C3AED; font-weight: 800; font-size: 24px;">SERVICE</div>
          <div style="color: #64748b; font-size: 10px; margin-top: 4px; letter-spacing: 1px;">RAPIDE & SÉCURISÉ</div>
        </div>
      </div>
      
      <h1 style="color: #2D1B69; font-size: 28px; margin-bottom: 10px; font-weight: bold;">${motif}</h1>
      <h2 style="color: #10B981; font-size: 36px; margin-top: 0; margin-bottom: 20px; font-family: 'Outfit', sans-serif;">${formattedAmount}</h2>
      
      <div id="custom-qr-placeholder" style="background: #ffffff; padding: 20px; border-radius: 20px; border: 4px solid #7C3AED; margin: 0 auto 20px auto; width: 250px; height: 250px; display: flex; justify-content: center; align-items: center; box-sizing: border-box;">
        <img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />
      </div>
      
      <p style="font-weight: 600; font-size: 20px; color: #1e1e2d; margin-bottom: 20px;">Scannez pour contribuer à cette campagne</p>
      
      <div style="display: flex; justify-content: center; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;">
        <div style="background: #FF0000; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">airtel <span style="font-weight: normal; font-size: 12px;">money</span></div>
        <div style="background: #FF6600; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">orange <span style="font-weight: normal; font-size: 12px;">money</span></div>
        <div style="background: #00A651; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">M-PESA</div>
        <div style="background: #6D28D9; color: white; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 16px;">afri <span style="font-weight: normal; font-size: 12px;">money</span></div>
      </div>
    </div>
  `;

  // 1 & 5. printWrapper avec opacity: 1 et z-index 999999
  printWrapper.appendChild(container);
  document.body.appendChild(printWrapper);

  // 2. Attente explicite que toutes les images (QR + Logo) et polices soient chargées à 100% avant capture
  const imgElements = Array.from(container.querySelectorAll('img'));
  const imgPromises = imgElements.map(img => {
    if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
    return new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  });

  Promise.all([...imgPromises, document.fonts ? document.fonts.ready : Promise.resolve()]).then(() => {
    // 3. Log de preuve du DOM juste avant capture
    console.log('[HD PDF Export Eglise - Before Capture] container.offsetWidth =', container.offsetWidth, '| container.offsetHeight =', container.offsetHeight, '| container.innerHTML.length =', container.innerHTML.length);

    const filename = 'Campagne_' + motif.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';

    if (typeof html2canvas !== 'undefined') {
      html2canvas(container, {
        scale: 2, useCORS: true, logging: false, windowWidth: 794, windowHeight: 1123, width: 794, height: 1123, x: 0, y: 0, scrollX: 0, scrollY: 0,
        onclone: function(clonedDoc) {
          const w = clonedDoc.getElementById('printWrapper_eglise');
          if (w) { w.style.opacity = '1'; w.style.zIndex = '999999'; }
        }
      }).then(canvas => {
        if (!canvas || !canvas.height || !canvas.width) {
          throw new Error('Canvas invalide lors de la capture du container');
        }
        const ratio = canvas.height / canvas.width;
        const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || (typeof jspdf !== 'undefined' ? jspdf.jsPDF : null));
        
        if (jsPDFClass) {
          const doc = new jsPDFClass({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
          });
          while (doc.internal.getNumberOfPages() > 1) {
            doc.deletePage(doc.internal.getNumberOfPages());
          }
          const pageWidth = 210;
          const pageHeight = 297;
          let finalWidth = pageWidth;
          let finalHeight = finalWidth * ratio;
          if (finalHeight > pageHeight) {
            finalHeight = pageHeight;
            finalWidth = finalHeight / ratio;
          }
          const offsetX = (pageWidth - finalWidth) / 2;
          const offsetY = (pageHeight - finalHeight) / 2;
          doc.addImage(canvas.toDataURL('image/jpeg', 0.99), 'JPEG', offsetX, offsetY, finalWidth, finalHeight);
          doc.save(filename);
          if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
          showToast('✅ PDF de campagne téléchargé sur 1 page exacte (100% net HD) !', 'success');
        } else if (typeof html2pdf !== 'undefined') {
          html2pdf().set({
            margin: 0,
            filename: filename,
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          }).toPdf().get('pdf').then(function(pdf) {
            while (pdf.internal.getNumberOfPages() > 1) {
              pdf.deletePage(pdf.internal.getNumberOfPages());
            }
            const pageWidth = 210;
            const pageHeight = 297;
            let finalWidth = pageWidth;
            let finalHeight = finalWidth * ratio;
            if (finalHeight > pageHeight) {
              finalHeight = pageHeight;
              finalWidth = finalHeight / ratio;
            }
            const offsetX = (pageWidth - finalWidth) / 2;
            const offsetY = (pageHeight - finalHeight) / 2;
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.99), 'JPEG', offsetX, offsetY, finalWidth, finalHeight);
            return pdf;
          }).save().then(() => {
            if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
            showToast('✅ PDF de campagne téléchargé sur 1 page exacte (100% net HD) !', 'success');
          }).catch(err => {
            if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
            console.error('[PDF Export Error Eglise]', err);
            showToast('Erreur lors de la génération PDF : ' + (err?.message || err), 'error');
          });
        } else {
          if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
          showToast('Erreur : Bibliothèque jsPDF introuvable pour PDF A4', 'error');
        }
      }).catch(err => {
        if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
        console.error('[PDF Export Error Eglise]', err);
        showToast('Erreur lors de la capture PDF : ' + (err?.message || err), 'error');
      });
    } else if (typeof html2pdf !== 'undefined') {
      html2pdf().set({
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.99 },
        html2canvas: {
          scale: 2, useCORS: true, logging: false, windowWidth: 794, windowHeight: 1123, width: 794, height: 1123, x: 0, y: 0, scrollX: 0, scrollY: 0,
          onclone: function(clonedDoc) {
            const w = clonedDoc.getElementById('printWrapper_eglise');
            if (w) { w.style.opacity = '1'; w.style.zIndex = '999999'; }
          }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(container).toCanvas().then(function(c) {
        const canvas = c || this.prop.canvas;
        if (!canvas || !canvas.height) {
          throw new Error('Canvas introuvable ou invalide dans html2pdf');
        }
        return this.toPdf().get('pdf').then(function(pdf) {
          while (pdf.internal.getNumberOfPages() > 1) {
            pdf.deletePage(pdf.internal.getNumberOfPages());
          }
          const pageWidth = 210;
          const pageHeight = 297;
          const ratio = canvas.height / canvas.width;
          let finalWidth = pageWidth;
          let finalHeight = finalWidth * ratio;
          if (finalHeight > pageHeight) {
            finalHeight = pageHeight;
            finalWidth = finalHeight / ratio;
          }
          const offsetX = (pageWidth - finalWidth) / 2;
          const offsetY = (pageHeight - finalHeight) / 2;
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.99), 'JPEG', offsetX, offsetY, finalWidth, finalHeight);
          return pdf;
        });
      }).save().then(() => {
        if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
        showToast('✅ PDF de campagne téléchargé sur 1 page exacte (100% net HD) !', 'success');
      }).catch(err => {
        if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
        console.error('[PDF Export Error Eglise]', err);
        showToast('Erreur lors de la génération PDF : ' + (err?.message || err), 'error');
      });
    } else {
      if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
      showToast('Erreur : Bibliothèques PDF non chargées', 'error');
    }
  });
};

window.shareCustomQR = async function() {
  const motif = document.getElementById('campaignMotif').value.trim();
  const amount = document.getElementById('campaignAmount').value.trim();
  const currency = document.getElementById('campaignCurrency').value;

  if (!motif || !amount) {
    showToast('Campagne invalide.', 'error'); return;
  }
  const payLink = `${location.origin}/smart_pay.html?to=${auth.currentUser.uid}&amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(currency)}&desc=${encodeURIComponent(motif)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Donation pour la campagne: ' + motif, url: payLink });
    } else {
      await navigator.clipboard.writeText(payLink);
      showToast('Lien de campagne copié', 'success');
    }
  } catch(e) { showToast('Erreur de partage', 'error'); }
};

window.shareChurchLink = async function() {
  const link = document.getElementById('churchPayLink')?.textContent;
  if (!link) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Donation pour l\'Église', url: link });
    } else {
      await navigator.clipboard.writeText(link);
      showToast('Lien copié dans le presse-papiers', 'success');
    }
  } catch(e) { showToast('Erreur de partage', 'error'); }
};

function loadTodayTransactions(uid) {
  // Listen for successful transactions where the church is the receiver (action == 'debit' for the merchant perspective, or we can check receiverId if that's how pay.html works)
  // Let's use the same query as dashboard_marchand.html: where('userId', '==', uid), where('action', '==', 'debit')
  
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0,0,0,0);

  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    where('action', '==', 'debit'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  onSnapshot(q, snap => {
    const list = document.getElementById('txTableBody');
    let totalMonthCDF = 0, totalMonthUSD = 0;

    if (snap.empty) {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--c-text3);padding:24px;">Aucune donation récente.</td></tr>';
      document.getElementById('statDonations').textContent = '0 CDF';
      const usdEl = document.getElementById('statDonationsUSD'); if(usdEl) usdEl.textContent = '0 USD';
      return;
    }

    const badges = { 'succès':'badge-success', 'échoué':'badge-error', 'en_attente':'badge-warning' };
    const labels = { 'succès':'Reçu', 'échoué':'Échoué', 'en_attente':'En attente' };
    
    list.innerHTML = snap.docs.map(d => {
      const tx = d.data();
      
      // Calculate month total for successful ones
      if (tx.statut === 'succès' && tx.createdAt?.toDate() >= startOfMonth) {
        if (tx.currency === 'USD') {
          totalMonthUSD += Number(tx.montant) || 0;
        } else {
          totalMonthCDF += Number(tx.montant) || 0;
        }
      }

      return `
      <tr>
        <td>${fmtDate(tx.createdAt)}</td>
        <td>${tx.customerNumber || tx.senderName || 'Anonyme'}</td>
        <td>${tx.description || 'Donation / Offrande'}</td>
        <td style="color: var(--c-success); font-weight:600;">+${window.formatMoney ? window.formatMoney(tx.montant, tx.currency) : tx.montant + ' ' + (tx.currency||'CDF')}</td>
        <td><span class="badge ${badges[tx.statut] || 'badge-warning'}">${labels[tx.statut] || tx.statut}</span></td>
      </tr>`;
    }).join('');

    document.getElementById('statDonations').textContent = window.formatMoney ? window.formatMoney(totalMonthCDF, 'CDF') : totalMonthCDF + ' CDF';
    const usdEl = document.getElementById('statDonationsUSD'); if(usdEl) usdEl.textContent = window.formatMoney ? window.formatMoney(totalMonthUSD, 'USD') : totalMonthUSD + ' USD';
  });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
