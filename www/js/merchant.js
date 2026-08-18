// js/merchant.js — Paiement Marchand LIVE via FreshPay (PayDRC) & Studio QR
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp, doc, getDoc, setDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let currentUser = null;
let dynQRTimer = null;
let allMerchantTx = [];
let periodFilter = 'all';
let currencyFilter = 'all';

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }
  
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const u = userSnap.data() || {};
    const uType = u.type || 'particulier';
    if (!userSnap.exists() || uType !== 'marchand') {
      alert('Accès refusé. Cette page est réservée aux comptes marchands.');
      window.location.href = 'dashboard.html';
      return;
    }

    currentUser = user;
    const av = document.getElementById('userAvatar');
    if (av) av.textContent = (user.displayName || user.email || 'Z')[0].toUpperCase();
    
    // KYC badge
    const kb = document.getElementById('kycBadge');
    if (kb) {
      const kycLevels = { basique:'badge-warning', avance:'badge-primary', marchand:'badge-success' };
      const kycLabels = { basique:'KYC Basique', avance:'KYC Avancé', marchand:'KYC Marchand' };
      const kl = u.kycLevel || 'marchand';
      kb.innerHTML = `<span class="badge ${kycLevels[kl]||'badge-success'}">${kycLabels[kl]||'KYC Marchand'}</span>`;
    }

    // Load customized merchant profile details
    const merchantName = u.merchantName || user.displayName || 'Mon Commerce';
    const merchantTagline = u.merchantTagline || 'Scannez pour payer votre commande en toute simplicité';
    const merchantIcon = u.merchantIcon || 'shop';
    if (u.merchantLogoBase64) window._customMerchantLogoBase64 = u.merchantLogoBase64;

    const nameInput = document.getElementById('bizNameInput');
    const taglineInput = document.getElementById('bizTaglineInput');
    const iconSelect = document.getElementById('bizIconSelect');
    if (nameInput) nameInput.value = merchantName !== 'Mon Commerce' ? merchantName : (user.displayName || '');
    if (taglineInput) taglineInput.value = merchantTagline;
    if (iconSelect) iconSelect.value = merchantIcon;

    // Load mobile money receiver parameters
    const rOp = u.merchantReceiverOp || 'M-Pesa';
    const rPhone = u.merchantReceiverPhone || u.phone || '';
    const rCur = u.merchantReceiverCurrency || 'auto';
    const opSelect = document.getElementById('receiverOpSelect');
    const phoneInput = document.getElementById('receiverPhoneInput');
    const curSelect = document.getElementById('receiverCurrencySelect');
    if (opSelect) opSelect.value = rOp;
    if (phoneInput) phoneInput.value = rPhone;
    if (curSelect) curSelect.value = rCur;
    updateReceiverDisplay(rOp, rPhone, rCur);

    document.getElementById('appShell').style.display = '';
    document.getElementById('loadingScreen').style.display = 'none';

    generateStaticQR(user);
    loadMerchantHistory(user.uid);

  } catch (e) {
    console.error("Error fetching user profile", e);
    window.location.href = 'dashboard.html';
  }
});

window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

// ── 1. STUDIO QR CODE & LIVE PREVIEW ──
function generateStaticQR(user) {
  const payLink = `${location.origin}/smart_pay.html?to=${user.uid}`;
  const payLinkEl = document.getElementById('payLink');
  if (payLinkEl) payLinkEl.textContent = payLink;
  
  const box = document.getElementById('staticQR');
  if (box) {
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

  // Also render into preview poster box after slight delay for DOM insertion
  setTimeout(() => {
    updateLivePosterPreview();
  }, 100);
}

window.updateLivePosterPreview = function() {
  const nameInput = document.getElementById('bizNameInput');
  const taglineInput = document.getElementById('bizTaglineInput');
  const iconSelect = document.getElementById('bizIconSelect');

  const titleEl = document.getElementById('previewBizName');
  const tagEl = document.getElementById('previewBizTagline');
  const logoBoxEl = document.getElementById('previewBizLogoBox');
  const qrPreviewBox = document.getElementById('previewQRBox');

  const titleText = (nameInput?.value || currentUser?.displayName || 'MON COMMERCE').toUpperCase();
  const tagText = taglineInput?.value || 'Scannez pour payer votre commande';
  const iconVal = iconSelect?.value || 'shop';

  if (titleEl) titleEl.textContent = titleText;
  if (tagEl) tagEl.textContent = tagText;

  // Render logo or icon
  if (logoBoxEl) {
    if (window._customMerchantLogoBase64) {
      logoBoxEl.innerHTML = `<img src="${window._customMerchantLogoBase64}" style="max-height: 64px; max-width: 180px; object-fit: contain; margin: 0 auto; display: block; border-radius: 8px;" />`;
    } else {
      const iconMap = {
        'restaurant': '🍽 RESTAURANT / BAR',
        'shop': '🛍 BOUTIQUE / SUPERMARCHÉ',
        'pharmacy': '💊 PHARMACIE / SANTÉ',
        'transport': '🚕 TAXI / TRANSPORT',
        'hotel': '🏨 HÔTEL / SALON',
        'service': '🏢 SERVICES & BUREAUX'
      };
      logoBoxEl.innerHTML = `<div style="background: var(--c-surface2); color: var(--c-primary-light); font-weight: 800; font-size: 0.8rem; padding: 6px 14px; border-radius: 50px; display: inline-block; letter-spacing: 0.5px; border: 1px solid var(--c-border);">${iconMap[iconVal] || '🏪 COMMERCE'}</div>`;
    }
  }

  // Copy QR code canvas/img into preview box
  const origBox = document.getElementById('staticQR');
  if (origBox && qrPreviewBox) {
    const img = origBox.querySelector('img');
    const canvas = origBox.querySelector('canvas');
    let dataUrl = '';
    if (img && img.src && img.src.startsWith('data:image')) {
      dataUrl = img.src;
    } else if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    }
    if (dataUrl) {
      qrPreviewBox.innerHTML = `<img src="${dataUrl}" style="width: 180px; height: 180px; object-fit: contain; display: block; margin: 0 auto; border-radius: 12px;" />`;
    }
  }
};

window.handleLogoUpload = function(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Le fichier est trop volumineux (maximum 2 Mo)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(e) {
    window._customMerchantLogoBase64 = e.target.result;
    updateLivePosterPreview();
    showToast('Logo importé ! Cliquez sur Enregistrer pour mémoriser.', 'success');
  };
  reader.readAsDataURL(file);
};

window.clearCustomLogo = function() {
  window._customMerchantLogoBase64 = null;
  const input = document.getElementById('bizLogoInput');
  if (input) input.value = '';
  updateLivePosterPreview();
  showToast('Logo supprimé', 'info');
};

window.saveMerchantBizProfile = async function() {
  if (!currentUser) return;
  const btn = document.getElementById('btnSaveProfile');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;margin-right:8px;"></span>Enregistrement...'; }

  const nameInput = document.getElementById('bizNameInput');
  const taglineInput = document.getElementById('bizTaglineInput');
  const iconSelect = document.getElementById('bizIconSelect');

  try {
    const userRef = doc(db, 'users', currentUser.uid);
    const data = {
      merchantName: nameInput?.value || '',
      merchantTagline: taglineInput?.value || '',
      merchantIcon: iconSelect?.value || 'shop',
      updatedAt: Timestamp.now()
    };
    if (window._customMerchantLogoBase64) {
      data.merchantLogoBase64 = window._customMerchantLogoBase64;
    } else if (window._customMerchantLogoBase64 === null) {
      data.merchantLogoBase64 = null;
    }

    await setDoc(userRef, data, { merge: true });
    showToast('✅ Identité visuelle enregistrée avec succès !', 'success');
    updateLivePosterPreview();
  } catch (e) {
    console.error('[Save Profile Error]', e);
    showToast('Erreur : ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer l\'identité & Mémoriser mon Logo'; }
  }
};

// ── 2. BULLETIN A4 HD PRINT & DOWNLOAD (CENTERED, ZERO TRUNCATION) ──
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

  // Gather personalized merchant data
  const bizNameInput = document.getElementById('bizNameInput');
  const bizTaglineInput = document.getElementById('bizTaglineInput');
  const bizIconSelect = document.getElementById('bizIconSelect');
  
  const merchantTitle = (bizNameInput?.value || currentUser?.displayName || 'PAIEMENT MARCHAND').toUpperCase();
  const merchantTagline = bizTaglineInput?.value || 'Paiement sécurisé · Rapide et sans stress';
  let merchantLogoHtml = '';
  
  if (window._customMerchantLogoBase64) {
    merchantLogoHtml = `<img src="${window._customMerchantLogoBase64}" style="max-height: 85px; max-width: 240px; object-fit: contain; margin: 0 auto 12px auto; display: block; border-radius: 12px;" />`;
  } else {
    const iconMap = {
      'restaurant': '🍽 RESTAURANT / BAR',
      'shop': '🛍 BOUTIQUE / SUPERMARCHÉ',
      'pharmacy': '💊 PHARMACIE / SANTÉ',
      'transport': '🚕 TAXI / TRANSPORT',
      'hotel': '🏨 HÔTEL / SALON',
      'service': '🏢 SERVICES & BUREAUX'
    };
    const iconText = iconMap[bizIconSelect?.value || 'shop'] || '🏪 COMMERCE';
    merchantLogoHtml = `<div style="background: #ede9fe; color: #7C3AED; font-weight: 800; font-size: 15px; padding: 8px 18px; border-radius: 50px; display: inline-block; margin-bottom: 14px; letter-spacing: 1px;">${iconText}</div>`;
  }

  // Create offscreen fixed wrapper at (0,0) of the virtual 1200px viewport to prevent any horizontal offset or cropping
  // 1 & 5. printWrapper avec opacity: 1 (z-index 999999 au premier plan absolu pendant les 150ms de capture pour éviter d'être recouvert par le fond blanc du body)
  const printWrapper = document.createElement('div');
  printWrapper.id = 'printWrapper_zola';
  printWrapper.style.cssText = 'position: absolute; left: 0; top: 0; width: 794px; height: 1123px; z-index: -999999; background: #ffffff; opacity: 0; pointer-events: none; overflow: hidden; margin: 0; padding: 0; border: none;';

  const container = document.createElement('div');
  container.style.cssText = 'position: absolute; left: 0; top: 0; width: 794px; height: 1123px; max-height: 1123px; padding: 40px 36px; background-color: #ffffff; color: #1e1e2d; font-family: Arial, sans-serif; text-align: center; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; margin: 0; overflow: hidden;';
  
  container.innerHTML = `
    <div style="border: 3px solid #7C3AED; border-radius: 24px; padding: 36px 28px; background: #ffffff; box-shadow: 0 10px 30px rgba(124,58,237,0.08); box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;">
      
      <!-- Top Brand Header -->
      <div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 2px dashed #e2e8f0;">
          <img src="icons/zolalogo192x192.png" alt="Zola Money" style="height: 60px; width: 60px; object-fit: contain;" />
          <div style="text-align: left; line-height: 1.15;">
            <div style="color: #e31e24; font-weight: 900; font-size: 25px; letter-spacing: 0.5px;">ZOLA <span style="color: #2D1B69;">MONEY</span> TRANS</div>
            <div style="color: #7C3AED; font-weight: 800; font-size: 14px; letter-spacing: 2px;">PAIEMENT MARCHAND SÉCURISÉ</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 3px; font-weight: 600;">AGRÉÉ · RAPIDE · SANS FRAIS CACHÉS</div>
          </div>
        </div>

        <!-- Custom Merchant Identity -->
        <div style="margin-bottom: 20px;">
          ${merchantLogoHtml}
          <h1 style="color: #1e1e2d; font-size: 32px; line-height: 1.2; font-weight: 900; margin: 0 0 6px 0; text-transform: uppercase; word-break: break-word;">${merchantTitle}</h1>
          <p style="color: #64748b; font-size: 16px; font-weight: 600; margin: 0;">${merchantTagline}</p>
        </div>
      </div>

      <!-- Centered QR Code Box -->
      <div style="margin: 10px 0;">
        <div style="background: #ffffff; padding: 20px; border-radius: 26px; border: 5px solid #7C3AED; margin: 0 auto; width: 290px; height: 290px; display: flex; justify-content: center; align-items: center; box-shadow: 0 15px 35px rgba(124, 58, 237, 0.22); box-sizing: border-box;">
          <img src="${dataUrl}" style="width: 240px; height: 240px; object-fit: contain; display: block; margin: 0 auto;" />
        </div>
        <div style="margin-top: 16px; font-size: 22px; font-weight: 900; color: #2D1B69; letter-spacing: 0.5px;">
          SCANNEZ POUR PAYER
        </div>
        <div style="font-size: 14px; font-weight: 700; color: #10B981; margin-top: 4px;">
          ✓ Accepté par tous les téléphones (Caméra & Mobile Money)
        </div>
      </div>

      <!-- Bottom Payment Operators & Currencies -->
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px;">
          DEVISES ACCEPTÉES : USD ($) ET CDF (FC)
        </div>
        <div style="display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;">
          <div style="background: #e31e24; color: white; padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 10px rgba(227,30,36,0.25);">M-PESA</div>
          <div style="background: #FF0000; color: white; padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 10px rgba(255,0,0,0.25);">airtel <span style="font-weight: 500; font-size: 12px;">money</span></div>
          <div style="background: #FF6600; color: white; padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 10px rgba(255,102,0,0.25);">orange <span style="font-weight: 500; font-size: 12px;">money</span></div>
          <div style="background: #6D28D9; color: white; padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 10px rgba(109,40,217,0.25);">afri <span style="font-weight: 500; font-size: 12px;">money</span></div>
        </div>
        
        <div style="background: linear-gradient(135deg, #2D1B69, #7C3AED); color: white; padding: 16px; border-radius: 16px; text-align: center;">
          <div style="font-size: 17px; font-weight: 800; color: #FBBF24; margin-bottom: 3px;">Sûr, rapide et sans monnaie manquante !</div>
          <div style="font-size: 13px; opacity: 0.9;">Votre paiement arrive instantanément et de manière sécurisée.</div>
        </div>
      </div>

    </div>
  `;

  // 1. printWrapper et container sont ajoutés au DOM AVANT tout appel à html2canvas
  printWrapper.appendChild(container);
  document.body.appendChild(printWrapper);

  showToast('⏳ Génération du PDF Haute Définition (A4 Centré)...', 'info');

  // 2. Attente explicite que toutes les images et polices web soient chargées à 100% avant capture
  const imgElements = Array.from(container.querySelectorAll('img'));
  const imgPromises = imgElements.map(img => {
    if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
    return new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  });

  Promise.all([...imgPromises, document.fonts ? document.fonts.ready : Promise.resolve()]).then(() => {
    // 3. Log de preuve du DOM juste avant l'appel à html2canvas
    console.log('[HD PDF Export - Before Capture] container.offsetWidth =', container.offsetWidth);

    const cleanSlug = (bizNameInput?.value || 'Zola_Marchand').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = name + '-' + cleanSlug + '.pdf';

    if (typeof html2canvas !== 'undefined') {
      html2canvas(container, {
        scale: 2, useCORS: true, logging: false, windowWidth: 794, windowHeight: 1123, width: 794, height: 1123, x: 0, y: 0, scrollX: 0, scrollY: 0,
        onclone: function(clonedDoc) {
          const w = clonedDoc.getElementById('printWrapper_zola');
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
          showToast('✅ Poster QR A4 téléchargé sur 1 page exacte (100% net HD) !', 'success');
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
            showToast('✅ Poster QR A4 téléchargé sur 1 page exacte (100% net HD) !', 'success');
          }).catch(err => {
            if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
            console.error('[PDF Export Error]', err);
            showToast('Erreur lors de la génération PDF : ' + (err?.message || err), 'error');
          });
        } else {
          if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
          showToast('Erreur : Bibliothèque jsPDF introuvable pour PDF A4', 'error');
        }
      }).catch(err => {
        if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
        console.error('[PDF Export Error]', err);
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
            const w = clonedDoc.getElementById('printWrapper_zola');
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
        showToast('✅ Poster QR A4 téléchargé sur 1 page exacte (100% net HD) !', 'success');
      }).catch(err => {
        if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
        console.error('[PDF Export Error]', err);
        showToast('Erreur lors de la génération PDF : ' + (err?.message || err), 'error');
      });
    } else {
      if (document.body.contains(printWrapper)) document.body.removeChild(printWrapper);
      showToast('Erreur : Bibliothèques PDF non chargées', 'error');
    }
  });
};

window.downloadQRImage = function(id, name) {
  const box = document.getElementById(id);
  if (!box) return;
  let dataUrl = '';
  const img = box.querySelector('img');
  if (img && img.src && img.src.startsWith('data:image')) {
    dataUrl = img.src;
  } else {
    const canvas = box.querySelector('canvas');
    if (canvas) dataUrl = canvas.toDataURL('image/png');
  }
  if (!dataUrl) { showToast('Image introuvable', 'error'); return; }
  const a = document.createElement('a');
  a.download = name + '.png';
  a.href = dataUrl;
  a.click();
  showToast('Image PNG téléchargée !', 'success');
};

window.shareLink = async function() {
  const link = document.getElementById('payLink')?.textContent;
  if (!link) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Paiement Zola Money Trans', text: 'Payez en toute sécurité en cliquant sur ce lien ou en scannant mon QR Code :', url: link });
    } else {
      await navigator.clipboard.writeText(link);
      showToast('Lien de paiement copié !', 'success');
    }
  } catch(e) { showToast('Lien copié dans le presse-papiers', 'success'); }
};

// ── 3. PARAMÉTRAGE MOBILE MONEY DE RÉCEPTION ──
window.saveMerchantSettings = async function() {
  const op = document.getElementById('receiverOpSelect')?.value || 'M-Pesa';
  const phone = document.getElementById('receiverPhoneInput')?.value || '';
  const cur = document.getElementById('receiverCurrencySelect')?.value || 'auto';
  
  if (!phone || phone.length < 8) {
    showToast('Veuillez entrer un numéro Mobile Money valide.', 'error');
    return;
  }
  
  const btn = document.getElementById('btnSaveReceiver');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;margin-right:8px;"></span>Enregistrement...'; }
  
  try {
    const userRef = doc(db, 'users', currentUser.uid);
    await setDoc(userRef, {
      merchantReceiverOp: op,
      merchantReceiverPhone: phone,
      merchantReceiverCurrency: cur,
      updatedAt: Timestamp.now()
    }, { merge: true });
    
    showToast('✅ Mode de réception Mobile Money enregistré et actif !', 'success');
    updateReceiverDisplay(op, phone, cur);
  } catch(e) {
    console.error('[Merchant Settings Error]', e);
    showToast('Erreur lors de l\'enregistrement : ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer mes paramètres de réception'; }
  }
};

function updateReceiverDisplay(op, phone, cur) {
  const alertEl = document.getElementById('receiverStatusAlert');
  const textEl = document.getElementById('receiverStatusText');
  if (alertEl && textEl && phone) {
    alertEl.style.display = 'flex';
    const curNames = { 'auto': 'Automatique (USD/CDF selon le client)', 'CDF': 'Tout convertir en CDF', 'USD': 'Tout convertir en USD' };
    textEl.innerHTML = `<strong>⚡ Prêt à encaisser !</strong> Les paiements QR arrivent sur <strong>${op} (${phone})</strong> · Devise : ${curNames[cur] || cur}.`;
  }
}

// ── 4. QR CODE DYNAMIQUE (AVEC MONTANT) ──
window.generateDynamicQR = function() {
  const amount = parseFloat(document.getElementById('dynAmount').value) || 0;
  const currency = document.getElementById('dynCurrency').value;
  const desc = document.getElementById('dynDesc').value.trim();
  const validity = parseInt(document.getElementById('dynValidity').value) || 30;

  const minAmt = currency === 'USD' ? 1 : 240;
  if (!amount || amount < minAmt) { showToast(`Montant minimum : ${minAmt} ${currency}`, 'error'); return; }

  const uid = currentUser?.uid;
  const expiresAt = Date.now() + validity * 60000;
  const qrData = JSON.stringify({ to: uid, amount, currency, desc, exp: expiresAt });

  const box = document.getElementById('dynamicQR');
  if (box) {
    box.innerHTML = '';
    new QRCode(box, { text: qrData, width: 200, height: 200, colorDark: '#7C3AED', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  }
  const wrap = document.getElementById('dynQRWrap');
  if (wrap) wrap.style.display = '';

  if (dynQRTimer) clearInterval(dynQRTimer);
  dynQRTimer = setInterval(() => {
    const rem = Math.max(0, expiresAt - Date.now());
    const m = String(Math.floor(rem/60000)).padStart(2,'0');
    const s = String(Math.floor((rem%60000)/1000)).padStart(2,'0');
    const timerEl = document.getElementById('dynTimer');
    if (timerEl) timerEl.textContent = `⏱ ${m}:${s} restant`;
    if (rem === 0) { clearInterval(dynQRTimer); if (wrap) wrap.style.display = 'none'; showToast('QR Code expiré', 'info'); }
  }, 1000);
};

// ── 5. SUIVI FINANCIER EN TEMPS RÉEL (USD & CDF) & HISTORIQUE ──
function loadMerchantHistory(uid) {
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(150)
  );

  onSnapshot(q, snap => {
    allMerchantTx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMerchantDashboardStatsAndTable();
  });
}

window.filterTxPeriod = function(period) {
  periodFilter = period;
  document.querySelectorAll('.btn-period-filter').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('btnFilterPeriod_' + period);
  if (activeBtn) activeBtn.classList.add('active');
  renderMerchantDashboardStatsAndTable();
};

window.filterTxCurrency = function(currency) {
  currencyFilter = currency;
  document.querySelectorAll('.btn-currency-filter').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('btnFilterCurrency_' + currency);
  if (activeBtn) activeBtn.classList.add('active');
  renderMerchantDashboardStatsAndTable();
};

function renderMerchantDashboardStatsAndTable() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Filter for period
  const filteredByPeriod = allMerchantTx.filter(tx => {
    const time = tx.createdAt?.toDate?.()?.getTime() || (tx.date ? new Date(tx.date).getTime() : 0);
    if (periodFilter === 'today') return time >= startOfToday;
    if (periodFilter === 'month') return time >= startOfMonth;
    return true;
  });

  // Calculate totals in USD and CDF
  let totalCDF = 0, countCDF = 0;
  let totalUSD = 0, countUSD = 0;

  filteredByPeriod.forEach(tx => {
    // Only count incoming payments / debits or successful captures
    if (tx.statut === 'succès' || !tx.statut || tx.statut === 'Reçu') {
      const amt = parseFloat(tx.montant) || 0;
      if (tx.currency === 'USD') {
        totalUSD += amt;
        countUSD++;
      } else {
        totalCDF += amt;
        countCDF++;
      }
    }
  });

  const cdfEl = document.getElementById('totalReceivedCDF');
  const cdfSubEl = document.getElementById('countReceivedCDF');
  const usdEl = document.getElementById('totalReceivedUSD');
  const usdSubEl = document.getElementById('countReceivedUSD');

  if (cdfEl) cdfEl.textContent = window.formatMoney ? window.formatMoney(totalCDF, 'CDF') : `${totalCDF.toLocaleString('fr-FR')} FC`;
  if (cdfSubEl) cdfSubEl.textContent = `${countCDF} encaissement${countCDF !== 1 ? 's' : ''} réussi${countCDF !== 1 ? 's' : ''}`;
  if (usdEl) usdEl.textContent = window.formatMoney ? window.formatMoney(totalUSD, 'USD') : `$${totalUSD.toFixed(2)} USD`;
  if (usdSubEl) usdSubEl.textContent = `${countUSD} encaissement${countUSD !== 1 ? 's' : ''} réussi${countUSD !== 1 ? 's' : ''}`;

  // Filter table by currency choice
  const filteredForTable = filteredByPeriod.filter(tx => {
    if (currencyFilter === 'all') return true;
    const cur = tx.currency || 'CDF';
    return cur === currencyFilter;
  });

  const tbody = document.getElementById('merchantTxBody');
  const countBadge = document.getElementById('txCountBadge');
  if (countBadge) countBadge.textContent = `${filteredForTable.length} transaction${filteredForTable.length !== 1 ? 's' : ''}`;

  if (!tbody) return;
  if (filteredForTable.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:36px;font-size:0.9rem;">Aucun encaissement trouvé pour cette sélection. Partagez ou affichez votre QR Code pour encaisser vos premiers clients !</td></tr>`;
    return;
  }

  const badges = { 'succès':'badge-success', 'Reçu':'badge-success', 'échoué':'badge-danger', 'Échoué':'badge-danger', 'en_attente':'badge-warning', 'En attente':'badge-warning' };
  const labels = { 'succès':'Reçu ✓', 'Reçu':'Reçu ✓', 'échoué':'Échoué ×', 'Échoué':'Échoué ×', 'en_attente':'En attente ⌛', 'En attente':'En attente ⌛' };
  const colors = { 'M-PESA':'#e31e24', 'AIRTEL':'#FF0000', 'ORANGE':'#FF6600', 'AFRIMONEY':'#6D28D9', 'AIRTEL MONEY':'#FF0000', 'ORANGE MONEY':'#FF6600' };

  tbody.innerHTML = filteredForTable.map(tx => {
    let dateStr = '—';
    if (tx.createdAt?.toDate) {
      dateStr = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(tx.createdAt.toDate());
    } else if (tx.date) {
      dateStr = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(tx.date));
    }
    const op = (tx.operateur || tx.method || 'M-Pesa').toUpperCase();
    const benef = tx.beneficiaire || tx.customerNumber || tx.clientNumber || 'Client non spécifié';
    const cur = tx.currency || 'CDF';
    const amtStr = window.formatMoney ? window.formatMoney(tx.montant, cur) : `${tx.montant} ${cur}`;
    const st = tx.statut || 'succès';

    return `
      <tr class="tx-item">
        <td style="color:var(--c-text2);font-size:0.83rem;">${dateStr}</td>
        <td><strong>${benef}</strong><div style="font-size:0.75rem;color:var(--c-text3);">${tx.reference || tx.type || 'Paiement QR'}</div></td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:0.82rem;">
            <span style="width:8px;height:8px;border-radius:50%;background:${colors[op] || '#7C3AED'};"></span>
            ${op}
          </span>
        </td>
        <td><span class="badge ${cur === 'USD' ? 'badge-primary' : 'badge-gold'}" style="font-size:0.72rem;">${cur}</span></td>
        <td style="font-family:'Outfit',sans-serif;font-weight:800;font-size:0.95rem;color:var(--c-text);">+${amtStr}</td>
        <td><span class="badge ${badges[st] || 'badge-warning'}" style="font-size:0.75rem;">${labels[st] || st}</span></td>
      </tr>
    `;
  }).join('');
}

window.exportMerchantCSV = function() {
  if (!allMerchantTx || allMerchantTx.length === 0) {
    showToast('Aucun encaissement à exporter pour le moment', 'info');
    return;
  }
  const header = 'Date & Heure,Client Payeur,Opérateur,Devise,Montant,Statut,Référence,Description';
  const rows = allMerchantTx.map(tx => {
    let dateStr = '';
    if (tx.createdAt?.toDate) dateStr = tx.createdAt.toDate().toLocaleString('fr-FR');
    else if (tx.date) dateStr = new Date(tx.date).toLocaleString('fr-FR');
    return `"${dateStr}","${tx.beneficiaire || tx.customerNumber || ''}","${tx.operateur || ''}","${tx.currency || 'CDF'}","${tx.montant || 0}","${tx.statut || ''}","${tx.reference || ''}","${tx.description || 'Paiement QR'}"`;
  });
  const csv = [header, ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `Zola_Marchand_Encaissements_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('📥 Tableau des encaissements (USD & CDF) exporté avec succès !', 'success');
};
