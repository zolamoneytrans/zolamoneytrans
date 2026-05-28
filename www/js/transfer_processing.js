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

// Get reference from URL
const urlParams = new URLSearchParams(window.location.search);
const reference = urlParams.get('ref');

if (!reference) {
  showError("Référence de transaction manquante.");
}

onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  if (reference && !isError) {
    listenToParentTransaction(user);
  }
});

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
}

function listenToParentTransaction(user) {
  const q = query(collection(db, 'transactions'), where('reference', '==', reference), where('userId', '==', user.uid));
  
  parentUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) return; // Wait until it exists
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    if (data.statut === 'échoué') {
      showError("Le paiement par carte Visa a été refusé ou a échoué.");
      return;
    }
    
    if (data.statut === 'succès' && !parentConfirmed) {
      parentConfirmed = true;
      
      // Update UI for Step 1
      loader1.style.display = 'none';
      check1.style.display = 'block';
      step1.classList.remove('active');
      step1.classList.add('completed');
      text1.textContent = "Visa confirmé !";
      
      // Update UI for Step 2
      step2.classList.add('active');
      icon2.style.display = 'none';
      loader2.style.display = 'block';
      text2.textContent = "Initiation du paiement Mobile Money...";
      
      // Stop listening to parent, start listening to child
      parentUnsubscribe();
      listenToChildTransaction(user);
    }
  }, (error) => {
    console.error("Error listening to transaction:", error);
    showError("Erreur de connexion lors de la vérification du statut.");
  });
}

function listenToChildTransaction(user) {
  const q = query(collection(db, 'transactions'), where('parentReference', '==', reference), where('userId', '==', user.uid));
  
  childUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) return; // Wait until the backend creates the child transaction
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    if (data.statut === 'échoué') {
      showError("Le paiement vers le compte Mobile Money a échoué.");
      return;
    }
    
    if (data.statut === 'succès') {
      // Update UI for Step 2
      loader2.style.display = 'none';
      check2.style.display = 'block';
      step2.classList.remove('active');
      step2.classList.add('completed');
      text2.textContent = "Paiement Mobile Money effectué !";
      
      // Update UI for Step 3
      step3.classList.add('completed');
      icon3.innerHTML = '✨';
      text3.textContent = "Transfert terminé avec succès !";
      
      successContainer.style.display = 'block';
      
      // Cleanup
      childUnsubscribe();
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    } else if (data.statut === 'en_attente') {
      if (!pollingInterval) {
        pollingInterval = setInterval(async () => {
          try {
            await checkStatusFn({ reference: data.reference, firestoreId: doc.id });
          } catch (e) {
            console.error("Polling error:", e);
          }
        }, 5000);
      }
    }
  }, (error) => {
    console.error("Error listening to child transaction:", error);
    showError("Erreur de connexion lors du suivi du paiement Mobile Money.");
  });
}
