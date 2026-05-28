// js/help.js — Contrôleur du Centre d'Aide & Support
// Zola Money Trans · Swazi Appli Lab SARL

import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Déconnexion
window.handleLogout = async () => {
  try {
    await auth.signOut();
    window.location.href = 'auth.html';
  } catch(err) {
    console.error('[Help Logout] Erreur:', err);
    showToast('Erreur lors de la déconnexion : ' + err.message, 'error');
  }
};

// Recherche FAQ en temps réel
window.filterFAQs = function() {
  const query = document.getElementById('faqSearchInput').value.toLowerCase().trim();
  const faqItems = document.querySelectorAll('.faq-item');
  const noResults = document.getElementById('noResults');
  let visibleCount = 0;

  faqItems.forEach(item => {
    const summary = item.querySelector('summary').textContent.toLowerCase();
    const content = item.querySelector('.faq-content').textContent.toLowerCase();

    if (summary.includes(query) || content.includes(query)) {
      item.style.display = '';
      visibleCount++;
      // Auto-ouvrir l'accordéon si on recherche activement pour faciliter la lecture
      if (query.length > 2) {
        item.setAttribute('open', '');
      } else {
        item.removeAttribute('open');
      }
    } else {
      item.style.display = 'none';
      item.removeAttribute('open');
    }
  });

  if (visibleCount === 0) {
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }
};

// Écouteur Auth State
onAuthStateChanged(auth, user => {
  if (!user) {
    console.warn('[Help] Utilisateur non authentifié, redirection vers auth.html');
    window.location.href = 'auth.html';
    return;
  }

  // Affichage de l'interface
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  // Initiales de l'avatar utilisateur
  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) {
    const nameStr = user.displayName || user.email || 'Z';
    avatarEl.textContent = nameStr[0].toUpperCase();
  }
});
