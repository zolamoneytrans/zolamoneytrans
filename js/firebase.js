// ============================================================
// ZOLA MONEY TRANS — Configuration Firebase
// Swazi Appli Lab SARL © 2025-2026
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  onValue,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDx6B5ra6A4SK-v5c46YB95-PxzCjOoXdw",
  authDomain:        "zolamoneytransmarchand.firebaseapp.com",
  databaseURL:       "https://zolamoneytransmarchand-default-rtdb.firebaseio.com",
  projectId:         "zolamoneytransmarchand",
  storageBucket:     "zolamoneytransmarchand.firebasestorage.app",
  messagingSenderId: "358049435336",
  appId:             "1:358049435336:web:39af3a8603a7226a759ffd",
  measurementId:     "G-EYZY1JH3G8"
};

const app      = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth     = getAuth(app);
const db       = getFirestore(app);
const rtdb     = getDatabase(app);
const storage  = getStorage(app);
const functions = getFunctions(app, 'us-central1');

// ── Admin ──
export const ADMIN_EMAIL = "drnduwa@gmail.com";
export const isAdmin = user => user && user.email === ADMIN_EMAIL;

// ── Formatters ──
export const formatCDF  = amt => new Intl.NumberFormat('fr-CD', { style:'currency', currency:'CDF', maximumFractionDigits:0 }).format(amt);
export const formatUSD  = amt => new Intl.NumberFormat('fr-FR', { style:'currency', currency:'USD', minimumFractionDigits:2 }).format(amt);
export const formatDate = d => {
  if (!d) return '—';
  const date = d instanceof Timestamp ? d.toDate() : new Date(d);
  return new Intl.DateTimeFormat('fr-FR', { dateStyle:'medium', timeStyle:'short' }).format(date);
};

// ── Exports ──
export {
  app, analytics, auth, db, rtdb, storage, functions,
  // Auth
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendEmailVerification,
  RecaptchaVerifier, signInWithPhoneNumber,
  // Firestore
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp,
  // RTDB
  ref, set, get, push, onValue, update,
  // Functions
  httpsCallable
};
