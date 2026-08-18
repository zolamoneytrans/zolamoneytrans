import { auth, db } from './firebase.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const functions = getFunctions();
const checkStatusFn = httpsCallable(functions, 'checkStatus');

// Elements
const step1 = document.getElementById('step1');
const loader1 = document.getElementById('loader1');
const check1 = document.getElementById('check1');
const text1 = document.getElementById('text1');

const step2 = document.getElementById('step2');
const loader2 = document.getElementById('loader2');
const check2 = document.getElementById('check2');
const icon2 = document.getElementById('icon2');
const text2 = document.getElementById('text2');

const step3 = document.getElementById('step3');
const icon3 = document.getElementById('icon3');
const text3 = document.getElementById('text3');

const errorContainer = document.getElementById('errorContainer');
const errorMessage = document.getElementById('errorMessage');
const successContainer = document.getElementById('successContainer');

let parentUnsubscribe = null;
let childUnsubscribe = null;
let parentConfirmed = false;
let isError = false;
let pollingInterval = null;
let pageTimeout = null;

// Get reference from URL
const urlParams = new URLSearchParams(window.location.search);
const reference = urlParams.get('ref');

if (!reference) {
  showError("Référence de transaction manquante.");
}

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = 'auth.html'; return; }
  if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }
  if (reference && !isError) {
    listenToParentTransaction(user);
    startTimeout();
  }
});

function startTimeout() {
  pageTimeout = setTimeout(() => {
    if (!parentConfirmed || (parentConfirmed && loader2.style.display !== 'none')) {
      const timeoutContainer = document.getElementById('timeoutContainer');
      if (timeoutContainer) {
        timeoutContainer.style.display = 'block';
      }
    }
  }, 45000); // 45 seconds
}

function showError(msg) {
  isError = true;
  errorContainer.style.display = 'block';
  errorMessage.textContent = msg;
  
  // Stop loaders
  if (loader1) loader1.style.display = 'none';
  if (loader2) loader2.style.display = 'none';
  
  // Cleanup listeners
  if (parentUnsubscribe) parentUnsubscribe();
  if (childUnsubscribe) childUnsubscribe();
  if (pollingInterval) clearInterval(pollingInterval);
  if (pageTimeout) clearTimeout(pageTimeout);
  
  const timeoutContainer = document.getElementById('timeoutContainer');
  if (timeoutContainer) timeoutContainer.style.display = 'none';
}

function listenToParentTransaction(user) {
  const q = query(collection(db, 'transactions'), where('reference', '==', reference), where('userId', '==', user.uid));
  
  parentUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) return; // Wait until it exists
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    if (data.statut === 'échoué') {
      showError("Le paiement initial a échoué. Raisons : fonds insuffisants, code PIN non saisi ou carte rejetée. Support WhatsApp : +243 857767040.");
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) retryBtn.style.display = 'inline-block';
      return;
    }
    
    if (data.statut === 'succès' && !parentConfirmed) {
      parentConfirmed = true;
      
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      
      // Update UI for Step 1
      if (loader1) loader1.style.display = 'none';
      if (check1) check1.style.display = 'block';
      if (step1) {
        step1.classList.remove('active');
        step1.classList.add('completed');
      }
      if (text1) text1.textContent = "Paiement d'initiation confirmé (100% sécurisé) !";
      
      // Update UI for Step 2
      if (step2) step2.classList.add('active');
      if (icon2) icon2.style.display = 'none';
      if (loader2) loader2.style.display = 'block';
      if (text2) text2.textContent = "Versement autonome des fonds vers le bénéficiaire...";
      
      // Stop listening to parent, start listening to child
      if (parentUnsubscribe) parentUnsubscribe();
      listenToChildTransaction(user);
    } else if (data.statut === 'en_attente') {
      if (!pollingInterval) {
        pollingInterval = setInterval(async () => {
          try {
            await checkStatusFn({ reference: reference, firestoreId: doc.id });
          } catch (e) {
            console.error("Parent polling error:", e);
          }
        }, 5000);
      }
    }
  }, (error) => {
    console.error("Error listening to transaction:", error);
    showError("Erreur de connexion lors de la vérification du statut.");
  });
}

function listenToChildTransaction(user) {
  const q = query(collection(db, 'transactions'), where('parentReference', '==', reference), where('userId', '==', user.uid));
  
  childUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      // Si la transaction enfant n'est pas encore visible, on continue à appeler checkStatus sur le parent pour garantir le déclenchement autonome !
      if (!pollingInterval) {
        pollingInterval = setInterval(async () => {
          try {
            await checkStatusFn({ reference: reference });
          } catch (e) {
            console.error("Child creation polling error:", e);
          }
        }, 5000);
      }
      return;
    }
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    if (data.statut === 'échoué') {
      showError("Le versement final vers le bénéficiaire a rencontré une erreur réseau ou numéro invalide. Nos serveurs re-tenteront automatiquement ou contactez le support au +243 857767040.");
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) retryBtn.style.display = 'inline-block';
      return;
    }
    
    if (data.statut === 'succès') {
      // Update UI for Step 2
      if (loader2) loader2.style.display = 'none';
      if (check2) check2.style.display = 'block';
      if (step2) {
        step2.classList.remove('active');
        step2.classList.add('completed');
      }
      if (text2) text2.textContent = "Fonds versés et délivrés au bénéficiaire !";
      
      // Update UI for Step 3
      if (step3) step3.classList.add('completed');
      if (icon3) icon3.innerHTML = '✨';
      if (text3) text3.textContent = "🎉 Transfert délivré au bénéficiaire avec succès !";
      
      if (successContainer) successContainer.style.display = 'block';
      
      // Cleanup
      if (childUnsubscribe) childUnsubscribe();
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      if (pageTimeout) clearTimeout(pageTimeout);
      const timeoutContainer = document.getElementById('timeoutContainer');
      if (timeoutContainer) timeoutContainer.style.display = 'none';
    } else if (data.statut === 'en_attente') {
      if (!pollingInterval) {
        pollingInterval = setInterval(async () => {
          try {
            await checkStatusFn({ reference: data.reference, firestoreId: doc.id });
          } catch (e) {
            console.error("Child polling error:", e);
          }
        }, 5000);
      }
    }
  }, (error) => {
    console.error("Error listening to child transaction:", error);
    showError("Erreur de connexion lors du suivi du paiement Mobile Money.");
  });
}
