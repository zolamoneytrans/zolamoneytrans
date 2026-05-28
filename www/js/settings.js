// js/settings.js — Gestion du profil et des moyens de paiement
// Zola Money Trans · Swazi Appli Lab SARL

import { auth, db } from './firebase.js';
import { doc, getDoc, updateDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let currentUser = null;
let userDocRef = null;

// 6 Avatars Vectoriels Premium & Colorés (SVGs base64 pour PWA et Offline)
const DEFAULT_AVATARS = [
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%237C3AED'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23F59E0B'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%2310B981'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%233B82F6'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23EC4899'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%236366F1'/><circle cx='50' cy='35' r='18' fill='white'/><path d='M25,82 C25,62 75,62 75,82' fill='white'/></svg>"
];

// Déconnexion
window.handleLogout = async () => {
  await auth.signOut();
  window.location.href = 'auth.html';
};

// Initialisation et liaison temps réel
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  currentUser = user;
  userDocRef = doc(db, 'users', user.uid);
  
  // Chargement des avatars prédéfinis dans la grille
  renderAvatarGrid();
  
  // Écouter les données en temps réel depuis Firestore
  onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      bindUserData(data);
    } else {
      // Si l'utilisateur n'existe pas en base, on l'initialise
      const initialProfile = {
        name: user.displayName || 'Utilisateur Zola',
        email: user.email || '',
        phone: user.phoneNumber || '',
        photoURL: DEFAULT_AVATARS[0],
        kycLevel: 'basique',
        cardAttached: false,
        autoSettlementEnabled: false
      };
      setDoc(userDocRef, initialProfile);
    }
    
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
  });
});

// Affiche la grille des avatars
function renderAvatarGrid() {
  const container = document.getElementById('avatarChoiceContainer');
  container.innerHTML = DEFAULT_AVATARS.map((av, idx) => `
    <img src="${av}" class="avatar-choice" onclick="selectDefaultAvatar(${idx})" id="avc-${idx}" alt="Avatar prédéfini"/>
  `).join('');
}

// Binde les informations en base de données sur l'UI
function bindUserData(data) {
  // Nom complet et contact
  document.getElementById('profileName').value = data.name || '';
  document.getElementById('profilePhone').value = data.phone || '';
  document.getElementById('profileEmail').value = currentUser.email || '';
  
  // KYC Badge
  const kycLevel = data.kycLevel || 'basique';
  document.getElementById('profileKyc').textContent = kycLevel.toUpperCase();
  const topKycBadge = document.getElementById('kycBadge');
  if (topKycBadge) {
    if (kycLevel === 'marchand') {
      topKycBadge.innerHTML = `<span class="badge badge-success">💼 Marchand</span>`;
    } else if (kycLevel === 'avance') {
      topKycBadge.innerHTML = `<span class="badge badge-info">🛡️ KYC Avancé</span>`;
    } else {
      topKycBadge.innerHTML = `<span class="badge badge-warning">⚠️ KYC Basique</span>`;
    }
  }
  
  // Avatar
  const avatarUrl = data.photoURL || DEFAULT_AVATARS[0];
  document.getElementById('profilePicImg').src = avatarUrl;
  
  const topAvatar = document.getElementById('userAvatar');
  if (topAvatar) {
    if (avatarUrl.startsWith('data:image')) {
      topAvatar.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"/>`;
    } else {
      topAvatar.textContent = (data.name || currentUser.email || 'Z')[0].toUpperCase();
    }
  }
  
  // Sélection active dans la grille
  document.querySelectorAll('.avatar-choice').forEach(el => el.classList.remove('selected'));
  const avatarIdx = DEFAULT_AVATARS.indexOf(avatarUrl);
  if (avatarIdx !== -1) {
    const selectedBtn = document.getElementById(`avc-${avatarIdx}`);
    if (selectedBtn) selectedBtn.classList.add('selected');
  }

  // Auto-Payout settings
  const autoActive = !!data.autoSettlementEnabled;
  document.getElementById('autoSettlementSwitch').checked = autoActive;
  
  const autoForm = document.getElementById('autoSettlementForm');
  if (autoActive) {
    autoForm.style.display = 'flex';
  } else {
    autoForm.style.display = 'none';
  }
  
  document.getElementById('autoSettlementMethod').value = data.autoSettlementMethod || 'mpesa';
  document.getElementById('autoSettlementTarget').value = data.autoSettlementTarget || '';
  updatePayoutPlaceholder();

  // Carte Visa
  const cardAttached = !!data.cardAttached;
  const visaStatusBadge = document.getElementById('visaStatusBadge');
  const visaActionBtn = document.getElementById('visaActionBtn');
  const visaDeleteBtn = document.getElementById('visaDeleteBtn');
  
  if (cardAttached) {
    visaStatusBadge.textContent = 'Active';
    visaStatusBadge.className = 'badge badge-success';
    
    document.getElementById('vcNumber').textContent = `•••• •••• •••• ${data.cardLast4 || '0000'}`;
    document.getElementById('vcHolder').textContent = data.cardHolder || 'NOM DU TITULAIRE';
    document.getElementById('vcExpiry').textContent = data.cardExpiry || 'MM/AA';
    
    visaActionBtn.textContent = 'Modifier la carte Visa';
    visaDeleteBtn.style.display = 'block';
  } else {
    visaStatusBadge.textContent = 'Aucune carte';
    visaStatusBadge.className = 'badge badge-warning';
    
    document.getElementById('vcNumber').textContent = '•••• •••• •••• ••••';
    document.getElementById('vcHolder').textContent = 'VOTRE NOM';
    document.getElementById('vcExpiry').textContent = '--/--';
    
    visaActionBtn.textContent = 'Associer une carte Visa';
    visaDeleteBtn.style.display = 'none';
  }

  // PIN
  if (data.pin) {
    const pinInput = document.getElementById('userPin');
    if (pinInput) {
      pinInput.value = '******';
      // Permettre la modification en vidant le champ
      pinInput.onfocus = () => {
        if (pinInput.value === '******') {
          pinInput.value = '';
        }
      };
      document.getElementById('savePinBtn').textContent = 'Modifier le PIN';
      document.getElementById('pinStatusLabel').textContent = 'Code PIN actuel (Configuré)';
    }
  } else {
    document.getElementById('pinStatusLabel').textContent = 'Nouveau Code PIN (6 chiffres)';
    document.getElementById('savePinBtn').textContent = 'Configurer le PIN';
  }
}

// ── Gestion de l'avatar ──

// Sélection d'un avatar prédéfini
window.selectDefaultAvatar = async function(idx) {
  const av = DEFAULT_AVATARS[idx];
  try {
    await updateDoc(userDocRef, { photoURL: av });
    showToast('Avatar mis à jour !', 'success');
  } catch (err) {
    showToast('Erreur lors du changement d\'avatar', 'error');
  }
};

// Déclencher le clic sur le fichier caché
window.triggerFileInput = function() {
  document.getElementById('avatarFileInput').click();
};

// Importer et compresser une image locale (PWA Offline-First friendly)
window.handleImageUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showToast('Veuillez sélectionner un fichier image valide', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Downscaling à 128x128px pour limiter le stockage Firestore à < 15kb
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 128;
      canvas.height = 128;
      
      // Recadrage central
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
      const base64Scaled = canvas.toDataURL('image/jpeg', 0.85);
      
      // Enregistrer directement sur Firestore
      updateDoc(userDocRef, { photoURL: base64Scaled })
        .then(() => showToast('Photo de profil mise à jour !', 'success'))
        .catch(err => {
          console.error(err);
          showToast('Erreur lors de l\'enregistrement de l\'image', 'error');
        });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

// ── Informations Personnelles ──
window.saveProfile = async function(e) {
  e.preventDefault();
  const name = document.getElementById('profileName').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  
  if (!name) {
    showToast('Le nom est requis', 'error');
    return;
  }
  
  try {
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
    
    await updateDoc(userDocRef, { name, phone });
    showToast('Profil enregistré avec succès !', 'success');
  } catch (err) {
    showToast('Erreur lors de la sauvegarde du profil', 'error');
  } finally {
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = false;
    btn.textContent = 'Enregistrer';
  }
};

// ── Règlement Automatique (Auto-Payout) ──

window.toggleAutoSettlementFields = function() {
  const enabled = document.getElementById('autoSettlementSwitch').checked;
  const form = document.getElementById('autoSettlementForm');
  if (enabled) {
    form.style.display = 'flex';
  } else {
    form.style.display = 'none';
    // Désactiver également en base si l'utilisateur décoche
    if (userDocRef) {
      updateDoc(userDocRef, { autoSettlementEnabled: false })
        .then(() => showToast('Versement automatique désactivé', 'info'))
        .catch(() => showToast('Erreur', 'error'));
    }
  }
};

window.updatePayoutPlaceholder = function() {
  const method = document.getElementById('autoSettlementMethod').value;
  const label = document.getElementById('payoutTargetLabel');
  const input = document.getElementById('autoSettlementTarget');
  
  if (method === 'visa') {
    label.textContent = "Numéro de carte Visa ou IBAN de réception";
    input.placeholder = "Ex: 4000 1234 5678 9010 ou CD93...";
  } else {
    label.textContent = `Numéro de téléphone mobile (${method.toUpperCase()})`;
    input.placeholder = "Ex: 0820000000";
  }
};

window.saveAutoSettlement = async function() {
  const enabled = document.getElementById('autoSettlementSwitch').checked;
  const method = document.getElementById('autoSettlementMethod').value;
  const target = document.getElementById('autoSettlementTarget').value.trim();
  
  if (enabled && !target) {
    showToast('Veuillez saisir une coordonnées de réception', 'error');
    return;
  }
  
  try {
    await updateDoc(userDocRef, {
      autoSettlementEnabled: enabled,
      autoSettlementMethod: method,
      autoSettlementTarget: target
    });
    showToast('Paramètres de versement sauvegardés !', 'success');
  } catch (err) {
    showToast('Erreur lors de la sauvegarde', 'error');
  }
};

// ── Gestion de la carte Visa ──

window.toggleVisaForm = function() {
  const form = document.getElementById('visaForm');
  form.classList.toggle('open');
};

// Formater dynamiquement l'expiration MM/AA
window.formatExpiry = function(input) {
  let val = input.value.replace(/\D/g, '');
  if (val.length > 2) {
    val = val.substring(0, 2) + '/' + val.substring(2, 4);
  }
  input.value = val;
};

// Formater dynamiquement le numéro de carte bancaire (espaces tous les 4 chiffres)
window.formatCardNumber = function(input) {
  let val = input.value.replace(/\D/g, '');
  let formatted = '';
  for (let i = 0; i < val.length; i++) {
    if (i > 0 && i % 4 === 0) formatted += ' ';
    formatted += val[i];
  }
  input.value = formatted;
};

// Synchroniser en temps réel le widget 3D de la carte avec les champs saisis
window.syncVisaWidget = function() {
  const holder = document.getElementById('cardHolderName').value.toUpperCase();
  const number = document.getElementById('cardNumber').value;
  const expiry = document.getElementById('cardExpiryInput').value;
  
  document.getElementById('vcHolder').textContent = holder || 'VOTRE NOM';
  document.getElementById('vcNumber').textContent = number || '•••• •••• •••• ••••';
  document.getElementById('vcExpiry').textContent = expiry || '--/--';
};

// Validation de la carte (Algorithme de Luhn & Préfixe Visa)
function validateVisa(number) {
  const cleanNumber = number.replace(/\s/g, '');
  if (!cleanNumber.startsWith('4')) {
    return { valid: false, msg: "Seules les cartes Visa (commençant par 4) sont acceptées." };
  }
  if (cleanNumber.length < 13 || cleanNumber.length > 19) {
    return { valid: false, msg: "Longueur de numéro de carte invalide." };
  }
  
  // Luhn Algorithm
  let sum = 0;
  let shouldDouble = false;
  for (let i = cleanNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanNumber.charAt(i));
    if (shouldDouble) {
      if ((digit *= 2) > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return { valid: (sum % 10 === 0), msg: "Numéro de carte bancaire incorrect." };
}

// Associer une nouvelle carte
window.attachVisaCard = async function(e) {
  e.preventDefault();
  
  const holder = document.getElementById('cardHolderName').value.trim();
  const number = document.getElementById('cardNumber').value.trim();
  const expiry = document.getElementById('cardExpiryInput').value.trim();
  const cvv = document.getElementById('cardCvv').value.trim();
  
  const validation = validateVisa(number);
  if (!validation.valid) {
    showToast(validation.msg, 'error');
    return;
  }
  
  // Validation format expiration MM/AA
  if (!/^\d{2}\/\d{2}$/.test(expiry)) {
    showToast('Format d\'expiration invalide (MM/AA)', 'error');
    return;
  }
  
  if (cvv.length < 3) {
    showToast('Code CVV incorrect (3 chiffres requis)', 'error');
    return;
  }
  
  try {
    const cleanNumber = number.replace(/\s/g, '');
    const last4 = cleanNumber.slice(-4);
    
    await updateDoc(userDocRef, {
      cardAttached: true,
      cardLast4: last4,
      cardHolder: holder,
      cardExpiry: expiry,
      // Note : En production réelle, le CVV et le numéro complet seraient tokenisés de façon sécurisée (ex: PCI-DSS)
    });
    
    showToast('Carte Visa associée avec succès !', 'success');
    
    // Fermer et reset le formulaire
    document.getElementById('visaForm').classList.remove('open');
    document.getElementById('visaForm').reset();
  } catch (err) {
    showToast('Erreur lors de l\'association de la carte', 'error');
  }
};

// Supprimer la carte attachée
window.detachVisaCard = async function() {
  if (!confirm('Êtes-vous sûr de vouloir détacher votre carte Visa ?')) return;
  try {
    await updateDoc(userDocRef, {
      cardAttached: false,
      cardLast4: null,
      cardHolder: null,
      cardExpiry: null
    });
    showToast('Carte Visa détachée.', 'info');
  } catch (err) {
    showToast('Erreur lors du détachement de la carte', 'error');
  }
};

// ── Gestion du Code PIN ──
window.savePin = async function(e) {
  e.preventDefault();
  const pinInput = document.getElementById('userPin');
  const pin = pinInput.value.trim();

  if (pin === '******') {
    showToast('Veuillez entrer un nouveau PIN', 'info');
    return;
  }

  if (!/^\d{6}$/.test(pin)) {
    showToast('Le PIN doit contenir exactement 6 chiffres', 'error');
    return;
  }

  try {
    const btn = document.getElementById('savePinBtn');
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';

    // Dans une application de production, le PIN devrait être hashé (ex: bcrypt)
    // Ici on le stocke en clair ou chiffré basiquement pour la démo PWA Firestore
    await updateDoc(userDocRef, { pin: pin });
    
    showToast('Code PIN configuré avec succès !', 'success');
    pinInput.blur();
  } catch (err) {
    console.error(err);
    showToast('Erreur lors de la configuration du PIN', 'error');
  } finally {
    const btn = document.getElementById('savePinBtn');
    btn.disabled = false;
    btn.textContent = 'Modifier le PIN';
  }
};
