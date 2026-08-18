// ============================================================
// ZOLA MONEY TRANS — Firebase Cloud Functions
// Proxy sécurisé pour l'API FreshPay (PayDRC)
// Swazi Appli Lab SARL © 2025-2026
// Force Deploy 2

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

admin.initializeApp();
const db = admin.firestore();

// ── Credentials FreshPay (jamais exposés côté client) ──
const FRESHPAY_MERCHANT_ID  = 'jcX5EE4uxq*71XaTb';
const FRESHPAY_MERCHANT_SECRET = 'jz39wIV4JXXi6Vm@tb';
const FRESHPAY_FIRSTNAME = 'Emmanuel';
const FRESHPAY_LASTNAME  = 'Ndawa';
const FRESHPAY_EMAIL     = 'drnduwa@gmail.com';
const FRESHPAY_API_URL = 'https://paydrc.gofreshbakery.net/api/v5/';

// ── Credentials MokoAfrica (Visa) ──
const MOKO_API_KEY = 'cd3e9c4bcf01471a961e5c39ec205536';
const MOKO_SECRET  = 'a7a724abb9b433d9364cf9808f540167110fe610481a6a2bf1897f8965e36d16';
const MOKO_API_URL = 'https://card.gofreshpay.com/api/v1/payment/orders';

// Seuil AML : 2000 USD = ~5 800 000 CDF (taux approximatif)
const AML_THRESHOLD_CDF = 5800000;
const AML_THRESHOLD_USD = 2000;

// ── Helper: Appel FreshPay ──
async function freshpayRequest(payload) {
  const body = {
    merchant_id:     FRESHPAY_MERCHANT_ID,
    merchant_secrete: FRESHPAY_MERCHANT_SECRET,
    firstname:       FRESHPAY_FIRSTNAME,
    lastname:        FRESHPAY_LASTNAME,
    "e-mail":        FRESHPAY_EMAIL,
    ...payload
  };

  const response = await fetch(FRESHPAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
    timeout: 30000
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("FreshPay API Error:", text);
    throw new functions.https.HttpsError('internal', `FreshPay HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// ── Helper: Appel MokoAfrica (Visa) ──
async function mokoCardRequest(payload) {
  if (payload && payload.bill_to_phone) {
    let cp = String(payload.bill_to_phone).trim();
    if (/^[0-9+() -\s]{8,18}$/.test(cp)) {
      cp = cp.replace(/[^0-9+]/g, '');
      if (!cp.startsWith('+')) {
        if (cp.startsWith('0')) cp = '+243' + cp.substring(1);
        else cp = '+' + cp;
      }
      payload.bill_to_phone = cp;
    } else {
      payload.bill_to_phone = '+243820000000';
    }
  } else if (payload) {
    payload.bill_to_phone = '+243820000000';
  }

  const timestamp = new Date().toISOString();
  
  // Create HMAC-SHA256 signature
  const payloadStr = JSON.stringify(payload);
  const dataToSign = payloadStr + timestamp;
  const signature = crypto.createHmac('sha256', MOKO_SECRET)
                          .update(dataToSign)
                          .digest('hex');

  const response = await fetch(MOKO_API_URL, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-API-Key': MOKO_API_KEY,
      'X-Timestamp': timestamp,
      'X-Signature': signature
    },
    body: payloadStr,
    timeout: 30000
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("MokoAfrica API Error:", text);
    throw new functions.https.HttpsError('internal', `MokoAfrica HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// ── Helper: Sécurité, anti-spam & Velocity check ──
async function checkVelocityAndSecurity(uid, amountNum, currency, txType, reference, contextAuth = null) {
  if (contextAuth && contextAuth.token) {
    const email = contextAuth.token.email || '';
    if (email === 'zolamoneytrans@gmail.com' || email === 'drnduwa@gmail.com' || email === 'zolamoneytransmarchand@gmail.com' || contextAuth.token.admin === true) {
      return;
    }
  }
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const u = userDoc.data();
    if (u.role === 'admin' || u.admin === true || u.email === 'zolamoneytrans@gmail.com' || u.email === 'drnduwa@gmail.com' || u.email === 'zolamoneytransmarchand@gmail.com' || u.isTest === true || u.bypassKyc === true) {
      return;
    }
  }

  const secSnap = await db.collection('settings').doc('security').get();
  if (secSnap.exists && secSnap.data().emergencyLockdown === true) {
    if (txType !== 'payin') {
      throw new functions.https.HttpsError('permission-denied', 'Verrouillage d’urgence actif : Les décaissements et transferts sont temporairement suspendus pour protection.');
    }
  }

  const now = Date.now();
  const fiveMinsAgo = new Date(now - 5 * 60 * 1000);
  const oneMinAgo = new Date(now - 60 * 1000);

  const recentTxSnap = await db.collection('transactions')
    .where('userId', '==', uid)
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fiveMinsAgo))
    .orderBy('createdAt', 'desc')
    .get();

  let count5Min = recentTxSnap.size;
  let count1Min = 0;
  recentTxSnap.forEach(doc => {
    const data = doc.data();
    if (data.createdAt && typeof data.createdAt.toMillis === 'function' && data.createdAt.toMillis() >= oneMinAgo.getTime()) {
      count1Min++;
    }
  });

  if (count1Min >= 3 || count5Min >= 5) {
    await db.collection('security_logs').add({
      userId: uid,
      montant: amountNum,
      currency,
      txType,
      reference,
      motif: `Blocage anti-spam (Velocity) : ${count1Min} tx en 1 min ou ${count5Min} tx en 5 min.`,
      niveau: 'critique',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    throw new functions.https.HttpsError('resource-exhausted', 'Trop de tentatives en peu de temps. Votre requête a été bloquée par le bouclier anti-spam.');
  }
}

// ── Helper: Vérification KYC ──
async function verifyKYC(uid, amountCDF, contextAuth = null) {
  if (contextAuth && contextAuth.token) {
    const email = contextAuth.token.email || '';
    if (email === 'zolamoneytrans@gmail.com' || email === 'drnduwa@gmail.com' || email === 'zolamoneytransmarchand@gmail.com' || contextAuth.token.admin === true) {
      return { uid, email, role: 'admin', kycLevel: 'marchand', kycStatus: 'approuve' };
    }
  }
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    return { uid, role: 'user', kycLevel: 'marchand', kycStatus: 'approuve' };
  }
  const user = userDoc.data();

  if (user.role === 'admin' || user.admin === true || user.email === 'zolamoneytrans@gmail.com' || user.email === 'drnduwa@gmail.com' || user.email === 'zolamoneytransmarchand@gmail.com' || user.isTest === true || user.bypassKyc === true) {
    return user;
  }

  // STRICT SECURITY CHECK: Blocked or Suspended Account
  if (user.blocked === true || user.status === 'suspended') {
    throw new functions.https.HttpsError('permission-denied', 'Compte bloqué ou suspendu pour raisons de sécurité. Veuillez contacter le support.');
  }

  const kyc = user.kycLevel || 'basique';
  const kycStatus = user.kycStatus || 'en_attente';

  if (kycStatus !== 'approuve' && kycStatus !== 'soumis') {
    throw new functions.https.HttpsError('permission-denied', 'KYC non complété. Veuillez soumettre votre dossier KYC.');
  }

  // Limites selon niveau KYC (en CDF, ~2900 CDF = 1 USD)
  const limits = {
    basique:  { perTx: 290000,    perMonth: 1450000  },  // 100 USD / 500 USD
    avance:   { perTx: 2900000,   perMonth: 14500000 },  // 1000 USD / 5000 USD
    marchand: { perTx: 999999999, perMonth: 999999999 }
  };
  const limit = limits[kyc] || limits['basique'];
  if (amountCDF > limit.perTx) {
    throw new functions.https.HttpsError('permission-denied',
      `Montant dépasse la limite par transaction (${kyc} KYC). Améliorez votre niveau KYC.`);
  }
  return user;
}

// ── Helper: Check AML ──
async function checkAML(uid, amountCDF, currency, txType, reference) {
  const isUSD = currency === 'USD';
  const threshold = isUSD ? AML_THRESHOLD_USD * 2900 : AML_THRESHOLD_CDF;

  if (amountCDF >= threshold) {
    await db.collection('aml_alerts').add({
      userId: uid,
      montant: amountCDF,
      currency,
      txType,
      reference,
      motif: `Transaction ≥ 2 000 USD — Surveillance AML automatique`,
      niveau: 'critique',
      statut: 'En attente',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.warn(`[AML] Alerte créée pour UID ${uid}, montant ${amountCDF} ${currency}`);
  }
}

// ── VPC Connector Config for Static IP Routing ──
const vpcOptions = {
  vpcConnector: 'projects/zolamoneytransmarchand/locations/us-central1/connectors/moko-connector',
  vpcConnectorEgressSettings: 'ALL_TRAFFIC'
};

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTION 1 — PayIn (C2B) — Paiement entrant
// ═══════════════════════════════════════════════════════════
exports.payIn = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const { amount, currency, customerNumber, method, reference, description, txType, isTransfer, transferDest, transferBenef, transferAmount, returnUrl } = data;
  if (!amount || !currency || !customerNumber || !method || !reference) {
    throw new functions.https.HttpsError('invalid-argument', 'Paramètres manquants.');
  }

  const uid = context.auth.uid;
  const amountNum = parseFloat(amount);

  // Vérification KYC
  const user = await verifyKYC(uid, currency === 'USD' ? amountNum * 2900 : amountNum, context.auth);

  // Vérification anti-spam, Velocity & sécurité
  await checkVelocityAndSecurity(uid, amountNum, currency, txType || 'payin', reference, context.auth);

  // Vérification AML
  await checkAML(uid, currency === 'USD' ? amountNum * 2900 : amountNum, currency, txType || 'payin', reference);

  // Appel API (Visa vs Mobile Money)
  let fpResponse;
  let transactionId = '';
  let freshpayStatus = '';
  let links = null;
  let responseMessage = 'Transaction soumise';

  if (normMethod(method) === 'visa') {
    // Appel MokoAfrica pour Visa
    const nameParts = (user.name || user.displayName || 'Client Zola').split(' ');
    const mokoPayload = {
      amount: amountNum,
      currency: currency,
      merchant_reference: reference,
      bill_to_forename: nameParts[0] || 'Client',
      bill_to_surname: nameParts.slice(1).join(' ') || 'Zola',
      bill_to_email: user.email || 'info@zolamoneytrans.com',
      bill_to_phone: customerNumber || user.phone || '+243000000000',
      bill_to_address_line1: "Kinshasa",
      bill_to_address_city: "Kinshasa",
      bill_to_address_state: "Kin",
      bill_to_address_postal_code: "0000",
      bill_to_address_country: "CD",
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`,
      return_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback?redirect=true&ref=${reference}`,
      cancel_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback?redirect=true&ref=${reference}&cancel=true`
    };
    
    fpResponse = await mokoCardRequest(mokoPayload);
    transactionId = fpResponse.data?.transaction_uuid || '';
    freshpayStatus = fpResponse.status || '';
    links = fpResponse.data?.links || null;
    responseMessage = fpResponse.data?.message || responseMessage;
  } else {
    // Appel FreshPay pour Mobile Money
    fpResponse = await freshpayRequest({
      action: 'debit',
      amount: String(amountNum),
      currency,
      customer_number: formatPhoneLocal(customerNumber),
      reference,
      method: normMethod(method),
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    });
    transactionId = fpResponse.Transaction_id || '';
    freshpayStatus = fpResponse.Status || '';
    responseMessage = fpResponse.Comment || responseMessage;
  }

  // Enregistrement Firestore
  const txData = {
    userId: uid,
    userEmail: user.email || '',
    type: txType || (isTransfer ? 'Transfert sortant (Débit)' : 'Paiement QR'),
    action: 'debit',
    montant: amountNum,
    currency,
    operateur: method,
    customerNumber,
    reference,
    description: description || '',
    transactionId: transactionId,
    freshpayStatus: freshpayStatus,
    statut: 'en_attente',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (isTransfer) {
    txData.isTransfer = true;
    txData.transferDest = transferDest;
    txData.transferBenef = transferBenef;
    txData.transferAmount = transferAmount;
  }

  const txRef = await db.collection('transactions').add(txData);

  return {
    success: true,
    transactionId: transactionId,
    freshpayRef: reference,
    firestoreId: txRef.id,
    links: links,
    message: responseMessage
  };
});

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTION 2 — PayOut (B2C) — Transfert sortant
// ═══════════════════════════════════════════════════════════
exports.payOut = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const { amount, currency, beneficiaryNumber, method, reference, beneficiaryName, srcMethod } = data;
  if (!amount || !currency || !beneficiaryNumber || !method || !reference) {
    throw new functions.https.HttpsError('invalid-argument', 'Paramètres manquants.');
  }

  const uid = context.auth.uid;
  const amountNum = parseFloat(amount);

  const user = await verifyKYC(uid, currency === 'USD' ? amountNum * 2900 : amountNum, context.auth);
  await checkVelocityAndSecurity(uid, amountNum, currency, 'payout', reference, context.auth);
  await checkAML(uid, currency === 'USD' ? amountNum * 2900 : amountNum, currency, 'transfert', reference);

  const existingTx = await db.collection('transactions').where('reference', '==', reference).limit(1).get();
  if (!existingTx.empty) {
    throw new functions.https.HttpsError('already-exists', 'Une transaction avec cette référence est déjà en cours de traitement (Anti-double versement).');
  }

  // Verrou anti-double versement atomique si un document parent est lié
  let isSuspicious = false;
  let parentDocData = null;

  if (data.firestoreId || data.parentReference) {
    let alreadyPaidOut = false;
    try {
      await db.runTransaction(async (t) => {
        let parentDoc = null;
        if (data.firestoreId) {
          parentDoc = await t.get(db.collection('transactions').doc(data.firestoreId));
        } else if (data.parentReference) {
          const pQ = await db.collection('transactions').where('reference', '==', data.parentReference).limit(1).get();
          if (!pQ.empty) parentDoc = await t.get(pQ.docs[0].ref);
        }
        if (parentDoc && parentDoc.exists) {
          parentDocData = parentDoc.data();
          if (parentDocData.payOutInitiated || parentDocData.freshpayOutRef || parentDocData.settlementInitiated || parentDocData.settlementRef) {
            alreadyPaidOut = true;
          } else {
            t.update(parentDoc.ref, { payOutInitiated: true });
          }
        }
      });
    } catch (lockErr) {
      console.warn('[payOut] Erreur lock parent:', lockErr);
    }
    if (alreadyPaidOut) {
      throw new functions.https.HttpsError('already-exists', 'Un versement (PayOut) a déjà été initié ou effectué pour cette transaction. Double versement bloqué par sécurité.');
    }
  }

  // Determine if this payout is suspicious (no valid successful payin)
  if (!parentDocData || parentDocData.statut !== 'succès') {
    isSuspicious = true;
  }

  const cleanEmail = (user.email === 'drnduwa@gmail.com' && !user.admin && user.role !== 'admin') ? '' : (user.email || '');

  let fpResponse;
  const nMethod = normMethod(method);
  
  if (isSuspicious) {
    // Intercept and put on hold
    const txRef = await db.collection('transactions').add({
      userId: uid,
      userEmail: cleanEmail,
      type: 'Transfert',
      action: 'credit',
      montant: amountNum,
      currency,
      operateur: method,
      operateurSource: srcMethod || '',
      beneficiaire: beneficiaryName || beneficiaryNumber,
      beneficiaryNumber,
      reference,
      parentReference: data.parentReference || '',
      transactionId: '',
      freshpayStatus: 'ON_HOLD',
      statut: 'pending_admin_approval',
      isSuspiciousPayout: true,
      suspiciousReason: parentDocData ? 'Payin parent non abouti (statut != succès)' : 'Aucun payin parent fourni',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send alert email to admin
    const emailSubject = `⚠️ ALERTE SÉCURITÉ: Retrait suspect mis en attente - ${amountNum} ${currency}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #EF4444;">🚨 Retrait Suspect Bloqué</h2>
        <p>Un utilisateur a tenté d'effectuer un retrait (PayOut) sans qu'un dépôt préalable n'ait été validé.</p>
        <ul>
          <li><strong>ID Utilisateur:</strong> ${uid}</li>
          <li><strong>Email Utilisateur:</strong> ${cleanEmail || 'Non spécifié'}</li>
          <li><strong>Montant:</strong> ${amountNum} ${currency}</li>
          <li><strong>Bénéficiaire:</strong> ${beneficiaryName || beneficiaryNumber} (${method})</li>
          <li><strong>Référence:</strong> ${reference}</li>
          <li><strong>Raison:</strong> ${parentDocData ? 'Payin parent non abouti' : 'Aucun payin parent fourni'}</li>
        </ul>
        <p>La transaction a été mise en attente. Veuillez vous connecter au tableau de bord d'administration pour approuver ou révoquer cette transaction.</p>
      </div>
    `;
    
    try {
      await sendEmailWithNodemailer({
        to: 'zolamoneytrans@gmail.com',
        subject: emailSubject,
        html: emailHtml
      });
    } catch (emailErr) {
      console.error('[payOut] Failed to send suspicious alert email:', emailErr);
    }

    return {
      success: true,
      transactionId: '',
      freshpayRef: reference,
      firestoreId: txRef.id,
      message: 'Transaction mise en attente pour vérification de sécurité par un administrateur.',
      isSuspicious: true
    };
  }

  if (nMethod === 'visa' || nMethod === 'moko' || srcMethod === 'moko' || method === 'visa') {
    const nameParts = (user.name || user.displayName || 'Beneficiary Zola').split(' ');
    const mokoPayload = {
      amount: amountNum,
      currency: currency,
      merchant_reference: reference,
      order_type: 'payout',
      action: 'credit',
      bill_to_forename: nameParts[0] || 'Beneficiary',
      bill_to_surname: nameParts.slice(1).join(' ') || 'Zola',
      bill_to_email: user.email || 'info@zolamoneytrans.com',
      bill_to_phone: beneficiaryNumber || '+243000000000',
      bill_to_address_line1: "Kinshasa",
      bill_to_address_city: "Kinshasa",
      bill_to_address_state: "Kin",
      bill_to_address_postal_code: "0000",
      bill_to_address_country: "CD",
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    };
    fpResponse = await mokoCardRequest(mokoPayload);
  } else {
    fpResponse = await freshpayRequest({
      action: 'credit',
      amount: String(amountNum),
      currency: currency,
      customer_number: formatPhoneLocal(beneficiaryNumber),
      reference: reference,
      method: nMethod,
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    });
  }

  const txRef = await db.collection('transactions').add({
    userId: uid,
    userEmail: cleanEmail,
    type: 'Transfert',
    action: 'credit',
    montant: amountNum,
    currency,
    operateur: method,
    operateurSource: srcMethod || '',
    beneficiaire: beneficiaryName || beneficiaryNumber,
    beneficiaryNumber,
    reference,
    parentReference: data.parentReference || '',
    transactionId: fpResponse.Transaction_id || fpResponse.data?.transaction_uuid || '',
    freshpayStatus: fpResponse.Status || fpResponse.status || 'SUBMITTED',
    statut: 'en_attente',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    success: true,
    transactionId: fpResponse.Transaction_id || fpResponse.data?.transaction_uuid || '',
    freshpayRef: reference,
    firestoreId: txRef.id,
    message: fpResponse.Comment || fpResponse.data?.message || 'Transfert soumis'
  };
});


// ── Helper: Autonomous Transfer Payout Execution ──
async function triggerAutonomousTransferPayout(txDocRef, tx) {
  if (!tx || !tx.isTransfer) return false;
  let shouldInitiate = false;
  try {
    shouldInitiate = await db.runTransaction(async (t) => {
      const docSnap = await t.get(txDocRef);
      if (!docSnap.exists) return false;
      const data = docSnap.data();
      if (data.payOutInitiated || data.freshpayOutRef) return false;
      t.update(txDocRef, { payOutInitiated: true });
      return true;
    });
  } catch (txErr) {
    console.error('[AutonomousPayout] Firestore lock error:', txErr);
    return false;
  }

  if (!shouldInitiate) return false;

  const outRef = 'OUT_' + tx.reference;
  try {
    console.log(`[AutonomousPayout] Déclenchement automatique du PayOut (Crédit) pour la ref ${tx.reference}`);
    const fpOutResponse = await freshpayRequest({
      action: 'credit',
      amount: String(tx.transferAmount),
      currency: tx.currency,
      customer_number: formatPhoneLocal(tx.transferBenef),
      reference: outRef,
      method: normMethod(tx.transferDest),
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    });
    
    if (fpOutResponse.Status === 'Rejected' || fpOutResponse.resultCode === 1) {
        throw new Error(fpOutResponse.Comment || fpOutResponse.resultDescription || 'Rejeté par l\'API MokoAfrica');
    }
    
    await db.collection('transactions').add({
      userId: tx.userId,
      userEmail: tx.userEmail || '',
      type: 'Transfert entrant (Crédit)',
      action: 'credit',
      montant: parseFloat(tx.transferAmount),
      currency: tx.currency,
      operateur: tx.transferDest,
      operateurSource: tx.operateur || '',
      beneficiaire: tx.transferBenef,
      beneficiaryNumber: tx.transferBenef,
      reference: outRef,
      parentReference: tx.reference,
      statut: 'en_attente',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (errOut) {
    console.error('[AutonomousPayout] Erreur lors du déclenchement du payOut:', errOut);
    await db.collection('transactions').add({
      userId: tx.userId,
      userEmail: tx.userEmail || '',
      type: 'Transfert entrant (Crédit)',
      action: 'credit',
      montant: parseFloat(tx.transferAmount),
      currency: tx.currency,
      operateur: tx.transferDest,
      operateurSource: tx.operateur || '',
      beneficiaire: tx.transferBenef,
      beneficiaryNumber: tx.transferBenef,
      reference: outRef,
      parentReference: tx.reference,
      statut: 'échoué',
      transStatusDescription: errOut.message || 'Erreur FreshPay Payout',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return false;
  }
}

// ── Helper: Autonomous Merchant / QR Payment Payout Execution ──
async function triggerAutonomousMerchantPayout(txDocRef, tx) {
  if (!tx || (!tx.isGuestPayment && tx.type !== 'Paiement QR Invité Reçu')) return false;
  
  let merchantPhone = tx.merchantReceiverPhone || tx.settlementPhone || '';
  let merchantOp = tx.merchantReceiverOp || tx.settlementOperator || 'M-Pesa';
  
  // Si non renseigné sur la transaction, on vérifie en direct le profil du marchand
  if (!merchantPhone || !formatPhoneLocal(merchantPhone)) {
    const targetUid = tx.beneficiaryUid || tx.userId;
    if (targetUid) {
      try {
        const userDoc = await db.collection('users').doc(targetUid).get();
        if (userDoc.exists) {
          const uData = userDoc.data();
          merchantPhone = uData.merchantReceiverPhone || uData.phone || '';
          merchantOp = uData.merchantReceiverOp || 'M-Pesa';
        }
      } catch (eUser) {
        console.warn('[AutonomousMerchantPayout] Erreur lecture profil marchand:', eUser);
      }
    }
  }

  if (!merchantPhone || !formatPhoneLocal(merchantPhone)) {
    console.warn(`[AutonomousMerchantPayout] Aucun numéro de compte mobile configuré par le marchand pour le versement automatique de ${tx.reference}.`);
    return false;
  }

  let shouldInitiate = false;
  try {
    shouldInitiate = await db.runTransaction(async (t) => {
      const docSnap = await t.get(txDocRef);
      if (!docSnap.exists) return false;
      const data = docSnap.data();
      // VERROU ATOMIQUE ANTI-DOUBLE VERSEMENT (Double Payout Protection)
      if (data.payOutInitiated || data.freshpayOutRef || data.settlementInitiated || data.settlementRef) {
        console.log(`[AutonomousMerchantPayout] Versement marchand déjà initié ou bloqué pour ${data.reference} (Anti-double payout).`);
        return false;
      }
      t.update(txDocRef, { 
        payOutInitiated: true,
        settlementInitiated: true 
      });
      return true;
    });
  } catch (txErr) {
    console.error('[AutonomousMerchantPayout] Firestore lock error:', txErr);
    return false;
  }

  if (!shouldInitiate) return false;

  const outRef = 'SETTLE_' + tx.reference;
  try {
    console.log(`[AutonomousMerchantPayout] Versement automatique de ${tx.montant || tx.amount} ${tx.currency} au marchand ${merchantPhone} (${merchantOp}) pour la ref ${tx.reference}`);
    const fpOutResponse = await freshpayRequest({
      action: 'credit',
      amount: String(tx.amountBase || tx.amountNet || tx.montant || tx.amount),
      currency: tx.currency || 'USD',
      customer_number: formatPhoneLocal(merchantPhone),
      reference: outRef,
      method: normMethod(merchantOp),
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    });

    if (fpOutResponse.Status === 'Rejected' || fpOutResponse.resultCode === 1) {
      throw new Error(fpOutResponse.Comment || fpOutResponse.resultDescription || 'Rejeté par l\'API MokoAfrica');
    }

    await db.collection('transactions').add({
      userId: tx.beneficiaryUid || tx.userId,
      beneficiaryUid: tx.beneficiaryUid || tx.userId,
      type: 'Reversement Marchand (PayOut QR)',
      action: 'credit',
      montant: parseFloat(tx.amountBase || tx.amountNet || tx.montant || tx.amount),
      currency: tx.currency || 'USD',
      operateur: merchantOp,
      beneficiaire: merchantPhone,
      beneficiaryNumber: merchantPhone,
      reference: outRef,
      parentReference: tx.reference,
      statut: 'en_attente',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await txDocRef.update({
      settlementRef: outRef,
      settlementPhone: merchantPhone,
      settlementOperator: merchantOp,
      settlementStatus: 'en_attente'
    });

    // Envoi notification au marchand
    try {
      await db.collection('notifications').add({
        userId: tx.beneficiaryUid || tx.userId,
        type: 'merchant_payout_triggered',
        title: '💸 Versement Marchand Automatique Initié !',
        message: `Le versement de ${tx.montant || tx.amount} ${tx.currency} (Ref: ${tx.reference}) a été envoyé vers votre compte mobile configuré ${merchantPhone} (${merchantOp}).`,
        reference: outRef,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (errNotif) {
      console.warn('[AutonomousMerchantPayout] Erreur notif:', errNotif);
    }

    return true;
  } catch (errOut) {
    console.error('[AutonomousMerchantPayout] Erreur lors du versement marchand:', errOut);
    await db.collection('transactions').add({
      userId: tx.beneficiaryUid || tx.userId,
      beneficiaryUid: tx.beneficiaryUid || tx.userId,
      type: 'Reversement Marchand (PayOut QR)',
      action: 'credit',
      montant: parseFloat(tx.montant || tx.amount),
      currency: tx.currency || 'USD',
      operateur: merchantOp,
      beneficiaire: merchantPhone,
      beneficiaryNumber: merchantPhone,
      reference: outRef,
      parentReference: tx.reference,
      statut: 'échoué',
      transStatusDescription: errOut.message || 'Erreur PayOut Marchand',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await txDocRef.update({
      settlementStatus: 'échoué',
      settlementError: errOut.message || 'Erreur PayOut'
    });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTION 3 — Check Transaction Status
// ═══════════════════════════════════════════════════════════
exports.checkStatus = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const { reference, firestoreId } = data;
  if (!reference) throw new functions.https.HttpsError('invalid-argument', 'Référence manquante.');

  const fpResponse = await freshpayRequest({ action: 'verify', reference });

  const transStatus = fpResponse.Trans_Status || fpResponse.Status;
  let statut = 'en_attente';
  if (transStatus === 'Successful') statut = 'succès';
  if (transStatus === 'Failed') statut = 'échoué';

  let txDocRef = null;
  let txData = null;

  if (firestoreId) {
    txDocRef = db.collection('transactions').doc(firestoreId);
    await txDocRef.update({
      statut,
      transStatus: fpResponse.Trans_Status || '',
      financialInstitutionId: fpResponse.Financial_Institution_id || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const snap = await txDocRef.get();
    if (snap.exists) txData = snap.data();
  } else {
    const snapQ = await db.collection('transactions').where('reference', '==', reference).limit(1).get();
    if (!snapQ.empty) {
      txDocRef = snapQ.docs[0].ref;
      await txDocRef.update({
        statut,
        transStatus: fpResponse.Trans_Status || '',
        financialInstitutionId: fpResponse.Financial_Institution_id || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      txData = snapQ.docs[0].data();
    }
  }

  if (statut === 'succès' && txDocRef && txData) {
    if (txData.isTransfer && !txData.payOutInitiated) {
      await triggerAutonomousTransferPayout(txDocRef, txData);
    }
    if ((txData.isGuestPayment || txData.type === 'Paiement QR Invité Reçu') && !txData.payOutInitiated && !txData.settlementInitiated) {
      await triggerAutonomousMerchantPayout(txDocRef, txData);
    }
  }

  return { statut, transStatus, details: fpResponse };
});

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTIONS — Notch Pay Integration (Visa, Mobile Money)
// ═══════════════════════════════════════════════════════════
const NOTCH_PUBLIC_KEY = 'pk.iA9hyiiIOa4MzkTz7reBUM4z8Oipa7SlNmHWNyiaedW8UHK2DTwPBQ4poo1mTi7DSUbkIqtacE8wZG52uyDDngrZppZvGJFvMKgZh7A6sypUY8M4gsPxmABTDA1EI';
const NOTCH_PRIVATE_KEY = 'sk.3HGrdSZbMcnedBT7YhCKBV3TgihGVOUJPmQvRTuqegMBKMBRdkLmjqJ3c2DvjljKv3Kpj4rl5xdZ70WActeadMq58SuPxIHlV8DHBMOQKiZwNsfZjq81vxWV4e1v2';

exports.notchInitPayment = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { amount, currency, email, name, phone, description, reference, callbackUrl } = data;
  
  const payload = {
    amount: parseFloat(amount) || 100,
    currency: currency || 'XAF',
    description: description || 'Notch Pay Simulation Admin',
    reference: reference || ('NOTCH-PAY-' + Date.now()),
    customer: {
      name: name || 'Admin Test',
      email: email || 'admin@zolamoneytrans.com'
    }
  };
  if (phone && phone.trim() !== '') payload.customer.phone = phone.trim();
  if (callbackUrl) payload.callback = callbackUrl;

  const res = await fetch('https://api.notchpay.co/payments', {
    method: 'POST',
    headers: {
      'Authorization': NOTCH_PUBLIC_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) {
    throw new functions.https.HttpsError('invalid-argument', json.message || 'Erreur initialisation Notch Pay', json);
  }
  return json;
});

exports.notchProcessPayIn = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { amount, currency, email, name, phone, channel, description } = data;
  await checkVelocityAndSecurity(context.auth.uid, parseFloat(amount) || 1, currency || 'USD', 'payin', 'NOTCH-IN', context.auth);

  // Normalisation intelligente du numéro de téléphone pour la RDC (+243)
  let cleanPhone = (phone || '').trim().replace(/\s+/g, '');
  if (cleanPhone.startsWith('00243')) cleanPhone = '+' + cleanPhone.substring(2);
  else if (cleanPhone.match(/^0[89]\d{8}$/)) cleanPhone = '+243' + cleanPhone.substring(1);
  else if (cleanPhone.match(/^[89]\d{8}$/)) cleanPhone = '+243' + cleanPhone;
  else if (cleanPhone.match(/^243\d{9}$/)) cleanPhone = '+' + cleanPhone;
  else if (!cleanPhone.startsWith('+') && cleanPhone.length >= 9) cleanPhone = '+' + cleanPhone;

  // 1. Initialiser le paiement (Sans envoyer customer.phone pour éviter l'erreur de validation 422 sur le pays par défaut)
  const payload = {
    amount: parseFloat(amount) || 1,
    currency: currency || 'USD',
    description: description || 'Notch Pay Mobile PayIn Simulation',
    reference: 'NOTCH-IN-' + Date.now(),
    customer: {
      name: name || 'Client Admin RDC',
      email: email || 'admin@zolamoneytrans.com'
    }
  };

  const initRes = await fetch('https://api.notchpay.co/payments', {
    method: 'POST',
    headers: {
      'Authorization': NOTCH_PUBLIC_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const initJson = await initRes.json();
  if (!initRes.ok) {
    throw new functions.https.HttpsError('invalid-argument', initJson.message || 'Erreur initialisation paiement Notch Pay', initJson);
  }

  const ref = initJson.transaction?.reference;
  if (!ref) {
    return { init: initJson, error: 'Référence de transaction introuvable' };
  }

  // 2. Traitement direct via PUT /payments/{reference} avec le numéro normalisé
  const putPayload = {
    channel: channel || 'cd.orange',
    data: {
      phone: cleanPhone
    }
  };

  let putRes = await fetch(`https://api.notchpay.co/payments/${ref}`, {
    method: 'PUT',
    headers: {
      'Authorization': NOTCH_PUBLIC_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(putPayload)
  });
  let putJson = await putRes.json();

  // Tentative de secours : Si l'opérateur exige le format sans signe + (ex: 243857767040 au lieu de +243857767040)
  if (!putRes.ok && cleanPhone.startsWith('+')) {
    const noPlusPhone = cleanPhone.substring(1);
    const putResFallback = await fetch(`https://api.notchpay.co/payments/${ref}`, {
      method: 'PUT',
      headers: {
        'Authorization': NOTCH_PUBLIC_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel: channel || 'cd.orange', data: { phone: noPlusPhone } })
    });
    if (putResFallback.ok) {
      putRes = putResFallback;
      putJson = await putResFallback.json();
    }
  }

  return { init: initJson, directProcess: putJson, httpStatus: putRes.status, normalizedPhone: cleanPhone };
});

exports.notchInitTransfer = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { amount, currency, channel, name, phone, description, reference } = data;
  await checkVelocityAndSecurity(context.auth.uid, parseFloat(amount) || 10, currency || 'USD', 'payout', reference || 'NOTCH-OUT', context.auth);

  let cleanPhone = (phone || '').trim().replace(/\s+/g, '');
  if (cleanPhone.startsWith('00243')) cleanPhone = '+' + cleanPhone.substring(2);
  else if (cleanPhone.match(/^0[89]\d{8}$/)) cleanPhone = '+243' + cleanPhone.substring(1);
  else if (cleanPhone.match(/^[89]\d{8}$/)) cleanPhone = '+243' + cleanPhone;
  else if (cleanPhone.match(/^243\d{9}$/)) cleanPhone = '+' + cleanPhone;
  else if (!cleanPhone.startsWith('+') && cleanPhone.length >= 9) cleanPhone = '+' + cleanPhone;

  const payload = {
    amount: parseFloat(amount) || 10,
    currency: currency || 'USD',
    channel: channel || 'cd.vodacom',
    description: description || 'Notch Pay Out Simulation',
    reference: reference || ('NOTCH-OUT-' + Date.now()),
    beneficiary_data: {
      name: name || 'Beneficiaire Admin',
      phone: cleanPhone
    }
  };

  const res = await fetch('https://api.notchpay.co/transfers', {
    method: 'POST',
    headers: {
      'Authorization': NOTCH_PUBLIC_KEY,
      'X-Grant': NOTCH_PRIVATE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) {
    return {
      error: true,
      httpStatus: res.status,
      message: json.message || 'Erreur Notch Pay Transfer',
      details: json
    };
  }
  return json;
});

exports.notchVerifyPayment = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { reference } = data;
  if (!reference) throw new functions.https.HttpsError('invalid-argument', 'Référence requise');
  
  const res = await fetch(`https://api.notchpay.co/payments/${reference}`, {
    method: 'GET',
    headers: {
      'Authorization': NOTCH_PUBLIC_KEY,
      'Content-Type': 'application/json'
    }
  });
  const json = await res.json();
  return json;
});

// ── SERDIPAY INTEGRATION ──
const SERDIPAY_EMAIL = "emmanuelnduwa2019@gmail.com";
const SERDIPAY_PWD = "christanne1A";
const SERDIPAY_API_ID = "APIE2DWB9A";
const SERDIPAY_MERCHANT_CODE = "141507";
const SERDIPAY_PIN = "1234";

async function getSerdipayToken() {
  const res = await fetch('https://www.zolamoneytrans.com/serdipay_proxy.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      endpoint: '/get-token',
      payload: { email: SERDIPAY_EMAIL, password: SERDIPAY_PWD } 
    })
  });
  const data = await res.json();
  if (res.ok && data.access_token) return data.access_token;
  throw new Error('Failed to get SerdiPay token: ' + JSON.stringify(data));
}

exports.serdiProcessPayIn = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { amount, currency, phone, telecom } = data;
  let cleanPhone = (phone || '').trim().replace(/\s+/g, '');
  if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
  if (cleanPhone.startsWith('00243')) cleanPhone = cleanPhone.substring(2);
  else if (cleanPhone.match(/^0[89]\d{8}$/)) cleanPhone = '243' + cleanPhone.substring(1);
  else if (cleanPhone.match(/^[89]\d{8}$/)) cleanPhone = '243' + cleanPhone;
  try {
    const token = await getSerdipayToken();
    const payload = {
      api_id: SERDIPAY_API_ID,
      api_password: SERDIPAY_PWD,
      merchantCode: SERDIPAY_MERCHANT_CODE,
      merchant_pin: SERDIPAY_PIN,
      clientPhone: cleanPhone,
      amount: parseFloat(amount),
      currency: currency || 'USD',
      telecom: telecom || 'MP'
    };
    const res = await fetch('https://www.zolamoneytrans.com/serdipay_proxy.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: '/payment-merchant',
        headers: { 'Authorization': `Bearer ${token}` },
        payload: payload
      })
    });
    const json = await res.json();
    return { httpStatus: res.status, data: json };
  } catch (error) {
    console.error("SerdiPay PayIn Error:", error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

exports.serdiProcessPayOut = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const { amount, currency, phone, telecom } = data;
  let cleanPhone = (phone || '').trim().replace(/\s+/g, '');
  if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
  if (cleanPhone.startsWith('00243')) cleanPhone = cleanPhone.substring(2);
  else if (cleanPhone.match(/^0[89]\d{8}$/)) cleanPhone = '243' + cleanPhone.substring(1);
  else if (cleanPhone.match(/^[89]\d{8}$/)) cleanPhone = '243' + cleanPhone;
  try {
    const token = await getSerdipayToken();
    const payload = {
      api_id: SERDIPAY_API_ID,
      api_password: SERDIPAY_PWD,
      merchantCode: SERDIPAY_MERCHANT_CODE,
      merchant_pin: SERDIPAY_PIN,
      clientPhone: cleanPhone,
      amount: parseFloat(amount),
      currency: currency || 'USD',
      telecom: telecom || 'MP'
    };
    const res = await fetch('https://www.zolamoneytrans.com/serdipay_proxy.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: '/payment-client',
        headers: { 'Authorization': `Bearer ${token}` },
        payload: payload
      })
    });
    const json = await res.json();
    return { httpStatus: res.status, data: json };
  } catch (error) {
    console.error("SerdiPay PayOut Error:", error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

exports.serdipayCallback = functions.runWith(vpcOptions).https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      const body = req.body;
      console.log("[SerdiPay Webhook] Received:", JSON.stringify(body));
      await db.collection('serdipay_logs').add({ payload: body, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      res.status(200).send('OK');
    } catch(err) {
      console.error("[SerdiPay Webhook Error]", err);
      res.status(500).send('Error');
    }
  });
});

// ── Callbacks Webhook Config ──
const CALLBACK_SECRET = 'd1612a0aafb627adce1b1db48fdfddde7b55d9eab7924758aa9e7dd12d367724';

function verifySignature(encryptedMessage, receivedSignature) {
  const hmac = crypto.createHmac('sha256', CALLBACK_SECRET);
  hmac.update(encryptedMessage);
  return hmac.digest('hex') === receivedSignature;
}

function decryptData(encryptedData) {
  // According to Moko Afrika Node.js example: AES-128-CBC with 16-byte key and IV
  const secretKey = Buffer.from(CALLBACK_SECRET.substring(0, 16), 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', secretKey, secretKey);
  let decrypted = decipher.update(Buffer.from(encryptedData, 'base64').toString('binary'), 'binary', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ═══════════════════════════════════════════════════════════
// HTTP FUNCTION — Webhook FreshPay Callback
// ═══════════════════════════════════════════════════════════
exports.freshpayCallback = functions.runWith(vpcOptions).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }

    try {
      let body = req.method === 'POST' ? req.body : req.query;
      console.log(`[Webhook] Received ${req.method} request. query:`, JSON.stringify(req.query));
      console.log(`[Webhook] Received body:`, JSON.stringify(body));

      // Check if it's an encrypted payload from FreshPay (Webhook)
      if (body && body.data) {
        const receivedSignature = req.headers['x-signature'];
        if (!receivedSignature) {
          console.error(`[Webhook] Signature missing`);
          return res.status(400).json({ error: "Signature missing" });
        }
        if (!verifySignature(body.data, receivedSignature)) {
          console.error(`[Webhook] Invalid signature`);
          return res.status(401).json({ error: "Invalid signature" });
        }
        try {
          body = decryptData(body.data);
          console.log(`[Webhook] Decrypted body:`, JSON.stringify(body));
        } catch (e) {
          console.error("Decryption error:", e);
          return res.status(400).json({ error: "Invalid encryption" });
        }
      }

      const reference = body.Reference || body.reference || body.merchant_reference || body.req_reference_number;
      const transStatus = body.Trans_Status || body.Status || body.status || body.decision;
      const transactionId = body.Transaction_id || body.transaction_uuid;
      console.log(`[Webhook] Parsed reference=${reference}, transStatus=${transStatus}, transactionId=${transactionId}`);

      if (!reference) { 
        if (req.query.redirect === 'true') {
          const refParam = req.query.ref || '';
          res.redirect(`https://zolamoneytransmarchand.web.app/transfer_processing.html?ref=${refParam}`);
        } else {
          res.status(400).json({ error: 'Reference missing' }); 
        }
        return; 
      }

      const ts = String(transStatus || '').toUpperCase();
      let statut = 'en_attente';
      if (ts === 'SUCCESSFUL' || ts === 'SUCCESS' || ts === 'COMPLETED' || ts === 'ACCEPT') statut = 'succès';
      if (ts === 'FAILED' || ts === 'FAIL' || ts === 'REJECT' || ts === 'DECLINE' || ts === 'ERROR') statut = 'échoué';

      // Trouver la transaction par référence et mettre à jour
      const snap = await db.collection('transactions').where('reference', '==', reference).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          statut,
          transStatus,
          financialInstitutionId: body.Financial_Institution_id || '',
          transStatusDescription: body.Trans_Status_Description || '',
          callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const tx = snap.docs[0].data();

        // Si succès — déclencher notification pour le commerçant
        if (statut === 'succès') {
          await db.collection('notifications').add({
            userId: tx.userId,
            type: 'payment_confirmed',
            montant: tx.montant,
            currency: tx.currency,
            operateur: tx.operateur,
            reference,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Si c'est un transfert inter-opérateur (Débit réussi), on lance immédiatement le Crédit (PayOut autonome)
          if (tx.isTransfer && !tx.payOutInitiated) {
            await triggerAutonomousTransferPayout(snap.docs[0].ref, tx);
          }
          // Si c'est un paiement QR / Invité vers le compte d'un marchand (Reversement automatique au compte mobile configuré)
          if ((tx.isGuestPayment || tx.type === 'Paiement QR Invité Reçu') && !tx.payOutInitiated && !tx.settlementInitiated) {
            await triggerAutonomousMerchantPayout(snap.docs[0].ref, tx);
          }

          // Si c'est un paiement par carte (Retrait Banque Visa/MC) réussi via callback MokoAfrica (après validation OTP par la banque)
          if (tx.type === 'card_deposit') {
            let shouldInitiate = false;
            try {
              shouldInitiate = await db.runTransaction(async (t) => {
                const txDoc = await t.get(snap.docs[0].ref);
                if (!txDoc.exists) return false;
                const txData = txDoc.data();
                if (txData.payOutInitiated || txData.freshpayOutRef) return false;
                t.update(snap.docs[0].ref, { payOutInitiated: true });
                return true;
              });
            } catch (txErr) {
              console.error('[Webhook CB] Transaction Firestore échouée pour payOutInitiated:', txErr);
            }

            if (shouldInitiate) {
              const outRef = 'OUT_' + reference;
              try {
                console.log(`[Webhook CB] Déclenchement automatique du PayOut Agent (Crédit) après confirmation OTP pour ref ${reference}`);
                
                const fpOutResponse = await freshpayRequest({
                  action: 'credit',
                  amount: String(tx.amountNet || tx.amount),
                  currency: tx.currencyOriginal || 'USD',
                  customer_number: formatPhoneLocal(tx.payoutPhone),
                  reference: outRef,
                  method: normMethod(tx.payoutOperator || 'mpesa'),
                  callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
                });

                await snap.docs[0].ref.update({
                  freshpayOutRef: outRef,
                  status: 'confirmed',
                  statut: 'succès',
                  freshpayStatus: (fpOutResponse && (fpOutResponse.Status || fpOutResponse.status)) || 'Success'
                });

                if (tx.agentUid && tx.agentUid !== 'marchand') {
                  const agentRefDoc = db.collection('agents').doc(tx.agentUid);
                  await db.runTransaction(async (t) => {
                    const agDoc = await t.get(agentRefDoc);
                    if (agDoc.exists) {
                      const agData = agDoc.data();
                      const curTotal = (agData.commissions && agData.commissions.total) || 0;
                      const curPending = (agData.commissions && agData.commissions.pending) || 0;
                      const comm = tx.agentCommission || 0;
                      t.update(agentRefDoc, {
                        'commissions.total': curTotal + comm,
                        'commissions.pending': curPending + comm
                      });
                    }
                  });
                }
              } catch (errOut) {
                console.error('[Webhook CB] Erreur lors du déclenchement du payOut Agent:', errOut);
                await snap.docs[0].ref.update({
                  payOutError: errOut.message || 'Erreur PayOut'
                });
              }
            }
          }
        }
      }

      if (req.query.redirect === 'true') {
        const refParam = req.query.ref || reference || '';
        res.redirect(`https://zolamoneytransmarchand.web.app/transfer_processing.html?ref=${refParam}`);
      } else {
        res.status(200).json({ status: 'Callback received successfully', data: body });
      }
    } catch (err) {
      console.error('[Webhook] Erreur:', err);
      if (req.query.redirect === 'true') {
        const refParam = req.query.ref || '';
        res.redirect(`https://zolamoneytransmarchand.web.app/transfer_processing.html?ref=${refParam}`);
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });
});

// ── Normalisation des méthodes opérateurs ──
function formatPhoneLocal(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/\D/g, '');
  if (clean.startsWith('243') && clean.length >= 12) {
    return '0' + clean.substring(3);
  }
  return clean;
}

function normMethod(m) {
  const map = {
    'mpesa': 'mpesa', 'm-pesa': 'mpesa', 'M-Pesa': 'mpesa',
    'airtel': 'airtel', 'Airtel Money': 'airtel', 'airtel money': 'airtel', 'airtelmoney': 'airtel',
    'orange': 'orange', 'Orange Money': 'orange', 'orange money': 'orange', 'orangemoney': 'orange',
    'afrimoney': 'afrimoney'
  };
  return map[m] || m.toLowerCase().replace(/\s+/g, '');
}

// ── Test Endpoint for API Credentials ──
exports.testFreshPay = functions.runWith(vpcOptions).https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const payload = req.body;
      const response = await fetch('https://paydrc.gofreshbakery.net/api/v5/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      res.status(200).send({ status: response.status, body: text });
    } catch (e) {
      res.status(500).send({ error: e.toString() });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTION 4 — Obtenir le profil d'un marchand (Public)
// ═══════════════════════════════════════════════════════════
async function fetchPublicBeneficiaryDetails(merchantUid) {
  if (!merchantUid) {
    return {
      uid: 'ZMT-DEMO',
      name: 'Bénéficiaire Zola',
      photoURL: 'icons/zolalogo96x96.png',
      kycLevel: 'marchand',
      tagline: 'Paiement Marchand Sécurisé Zola',
      icon: 'shop',
      receiverOp: 'M-Pesa',
      receiverPhone: '',
      receiverCurrency: 'auto'
    };
  }

  let merchSnap = await db.collection('users').doc(merchantUid).get();
  if (!merchSnap.exists) {
    const qSnap = await db.collection('users').where('merchantCode', '==', merchantUid).limit(1).get();
    if (!qSnap.empty) {
      merchSnap = qSnap.docs[0];
    } else {
      const cSnap = await db.collection('churches').doc(merchantUid).get();
      if (cSnap.exists) {
        merchSnap = cSnap;
      } else {
        const qCodeSnap = await db.collection('users').where('code', '==', merchantUid).limit(1).get();
        if (!qCodeSnap.empty) {
          merchSnap = qCodeSnap.docs[0];
        }
      }
    }
  }

  const merchData = merchSnap && merchSnap.exists ? merchSnap.data() : {};
  const isFound = merchSnap && merchSnap.exists;

  return {
    uid: isFound ? merchSnap.id : merchantUid,
    name: merchData.merchantName || merchData.churchName || merchData.name || merchData.displayName || (merchantUid.startsWith('ZMT-') ? merchantUid : `Bénéficiaire Zola (${merchantUid})`),
    photoURL: merchData.merchantLogoBase64 || merchData.photoURL || 'icons/zolalogo96x96.png',
    kycLevel: merchData.kycLevel || 'marchand',
    tagline: merchData.merchantTagline || merchData.description || 'Scannez pour payer votre commande en toute simplicité',
    icon: merchData.merchantIcon || 'shop',
    receiverOp: merchData.merchantReceiverOp || 'M-Pesa',
    receiverPhone: merchData.merchantReceiverPhone || merchData.phone || '',
    receiverCurrency: merchData.merchantReceiverCurrency || 'auto',
    autoSettlementEnabled: merchData.autoSettlementEnabled || false,
    autoSettlementMethod: merchData.autoSettlementMethod || null,
    autoSettlementTarget: merchData.autoSettlementTarget || null
  };
}

exports.getMerchantInfo = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  const { merchantUid } = data;
  if (!merchantUid && !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  }
  return await fetchPublicBeneficiaryDetails(merchantUid || (context.auth ? context.auth.uid : null));
});

exports.getPublicMerchantInfo = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  return await fetchPublicBeneficiaryDetails(data?.merchantUid);
});

exports.processGuestPayment = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  const { merchantUid, amount, amountBase, frais, currency, customerNumber, method, reference, description, payerName, payerEmail, txId } = data || {};
  if (!merchantUid || !amount || !currency || !customerNumber || !method) {
    throw new functions.https.HttpsError('invalid-argument', 'Paramètres de paiement manquants.');
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Montant invalide.');
  }

  const benefDetails = await fetchPublicBeneficiaryDetails(merchantUid);
  const benefName = benefDetails.name || 'Bénéficiaire Zola';

  const refVal = reference || `ZOLA-GUEST-${Date.now()}`;
  const descVal = description || `Paiement QR Invité de ${payerName || 'Client'}`;

  // VERROU ANTI DOUBLE-PAIEMENT
  if (reference) {
    const existingTxSnap = await db.collection('transactions').where('reference', '==', reference).get();
    if (!existingTxSnap.empty) {
      if (txId) {
        // If we have a txId, check if it matches the reference and is still 'en_attente'
        const existingDoc = existingTxSnap.docs.find(d => d.id === txId);
        if (!existingDoc) {
          throw new functions.https.HttpsError('already-exists', 'Transaction mismatch.');
        }
        if (existingDoc.data().statut !== 'en_attente') {
          throw new functions.https.HttpsError('already-exists', 'Cette transaction a déjà été traitée.');
        }
        
        // Ensure method allowed restriction is respected
        const allowed = existingDoc.data().allowedMethod || 'ALL';
        if (allowed === 'BANK_CARD' && normMethod(method) !== 'visa') {
          throw new functions.https.HttpsError('permission-denied', 'Mode de paiement non autorisé (Mobile Money interdit).');
        }
      } else {
        const isProcessing = existingTxSnap.docs.some(doc => ['en_attente', 'succès', 'en_traitement'].includes(doc.data().statut));
        if (isProcessing) {
          throw new functions.https.HttpsError('already-exists', 'Une transaction avec cette référence est déjà en cours ou terminée. (Double paiement évité)');
        }
      }
    }
  }

  let fpResponse;
  let transactionId = '';
  let freshpayStatus = '';
  let links = null;
  let responseMessage = 'Paiement invité initié avec succès';

  if (normMethod(method) === 'visa') {
    const nameParts = (payerName || 'Client Invité').split(' ');
    const mokoPayload = {
      amount: amountNum,
      currency: currency,
      merchant_reference: refVal,
      bill_to_forename: nameParts[0] || 'Client',
      bill_to_surname: nameParts.slice(1).join(' ') || 'Invité',
      bill_to_email: payerEmail || 'info@zolamoneytrans.com',
      bill_to_phone: customerNumber || '+243000000000',
      bill_to_address_line1: "Kinshasa",
      bill_to_address_city: "Kinshasa",
      bill_to_address_state: "Kin",
      bill_to_address_postal_code: "0000",
      bill_to_address_country: "CD",
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`,
      return_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback?redirect=true&ref=${refVal}`,
      cancel_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback?redirect=true&ref=${refVal}&cancel=true`
    };
    
    fpResponse = await mokoCardRequest(mokoPayload);
    transactionId = fpResponse.data?.transaction_uuid || `MOKO-${Date.now()}`;
    freshpayStatus = fpResponse.status || 'PENDING';
    links = fpResponse.data?.links || fpResponse.data?.link || fpResponse.data?.url || fpResponse.links || fpResponse.link || fpResponse.url || null;
    responseMessage = fpResponse.data?.message || responseMessage;
  } else {
    fpResponse = await freshpayRequest({
      action: 'debit',
      amount: String(amountNum),
      currency: currency,
      customer_number: formatPhoneLocal(customerNumber),
      reference: refVal,
      method: normMethod(method),
      callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
    });
    transactionId = fpResponse.Transaction_id || `FP-${Date.now()}`;
    freshpayStatus = fpResponse.Status || 'PENDING';
    responseMessage = fpResponse.Comment || responseMessage;
  }

  const txData = {
    userId: benefDetails.uid,
    beneficiaryUid: benefDetails.uid,
    beneficiaryName: benefName,
    type: 'Paiement QR Invité Reçu',
    action: 'credit',
    montant: amountNum,
    amountBase: amountBase ? parseFloat(amountBase) : amountNum,
    frais: frais ? parseFloat(frais) : 0,
    currency: currency,
    operateur: method,
    customerNumber: customerNumber,
    expediteur: payerName || customerNumber,
    payerName: payerName || 'Invité',
    payerEmail: payerEmail || '',
    reference: refVal,
    description: descVal,
    transactionId: transactionId,
    freshpayStatus: freshpayStatus,
    statut: 'en_attente',
    isGuestPayment: true,
    merchantReceiverPhone: benefDetails.receiverPhone || '',
    merchantReceiverOp: benefDetails.receiverOp || 'M-Pesa',
    payOutInitiated: false,
    settlementInitiated: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (txId) {
    await db.collection('transactions').doc(txId).update({
      operateur: method,
      customerNumber: customerNumber,
      expediteur: payerName || customerNumber,
      payerName: payerName || 'Invité',
      payerEmail: payerEmail || '',
      description: descVal,
      transactionId: transactionId,
      freshpayStatus: freshpayStatus
    });
  } else {
    await db.collection('transactions').add(txData);
  }

  return {
    success: true,
    transactionId: transactionId,
    status: freshpayStatus,
    links: links,
    message: responseMessage
  };
});

exports.dumpDb = functions.runWith(vpcOptions).https.onRequest(async (req, res) => {
  const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(20).get();
  res.json(snap.docs.map(d => ({id: d.id, ...d.data()})));
});

// ═══════════════════════════════════════════════════════════
// NODEMAILER HELPER & PDF GENERATOR
// ═══════════════════════════════════════════════════════════

let cachedTransporter = null;

async function sendEmailWithNodemailer({ to, subject, html, attachments }) {
  try {
    if (!cachedTransporter) {
      cachedTransporter = nodemailer.createTransport({
        pool: true,
        maxConnections: 10,
        maxMessages: 500,
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_EMAIL || 'zolamoneytrans@gmail.com',
          pass: process.env.SMTP_PASSWORD || 'VOTRE_MOT_DE_PASSE_APP_GMAIL'
        }
      });
    }

    await cachedTransporter.sendMail({
      from: `"Zola Money Trans" <${process.env.SMTP_EMAIL || 'zolamoneytrans@gmail.com'}>`,
      to: to,
      subject: subject,
      html: html,
      attachments: attachments
    });
    console.log(`[Nodemailer] Email sent successfully to ${to}`);
  } catch (error) {
    console.error('[Nodemailer Error] Failed to send email:', error);
    throw error;
  }
}

function generateReceiptPDF(txData, userName, txId) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Design du Reçu (Professionnel, minimaliste avec code couleur Zola)
      doc.fillColor('#7C3AED').fontSize(26).font('Helvetica-Bold').text('ZOLA MONEY TRANS', { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#374151').fontSize(14).font('Helvetica').text('Reçu de Transaction / Proof of Payment', { align: 'center' });
      doc.moveDown(2);
      
      const leftCol = 50;
      const rightCol = 220;
      let currentY = doc.y;

      const addRow = (label, value) => {
        doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(11).text(label, leftCol, currentY);
        doc.fillColor('#111827').font('Helvetica').text(String(value), rightCol, currentY);
        currentY += 22;
      };

      addRow('Date de la transaction :', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }));
      addRow('Nom du Client :', userName);
      addRow('N° Téléphone :', txData.customerNumber || txData.beneficiaryNumber || '—');
      addRow('ID Transaction (Ref) :', txData.reference || txId || '—');
      addRow('Partenaire (UUID) :', txData.transactionId || '—');
      addRow('Type :', txData.type || 'Paiement');
      addRow('Opérateur :', String(txData.operateur || '—').toUpperCase());
      
      currentY += 15;
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke('#E5E7EB');
      currentY += 25;
      
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#7C3AED').text('Montant Total :', leftCol, currentY);
      doc.fontSize(16).text(`${txData.montant} ${txData.currency}`, rightCol, currentY);
      currentY += 35;

      doc.moveTo(50, currentY).lineTo(550, currentY).stroke('#E5E7EB');
      currentY += 25;
      
      const isSuccess = txData.statut === 'succès';
      doc.fontSize(14).fillColor(isSuccess ? '#10B981' : '#EF4444');
      doc.text(`STATUT : ${String(txData.statut).toUpperCase()}`, leftCol, currentY);
      
      doc.moveDown(5);
      doc.fontSize(10).fillColor('#9CA3AF').text('Ce document est généré électroniquement et sert de preuve de paiement sur la plateforme Zola Money Trans.', 50, doc.y, { align: 'center' });
      doc.moveDown(0.5);
      doc.text('Pour toute question, contactez le support : support@zolamoneytrans.com', { align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─── BENDA BUS API INTEGRATION ───

exports.bendabusRegenerateKey = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Admin requise.');
  const newKey = 'bb_live_' + crypto.randomBytes(24).toString('hex');
  await db.collection('partners').doc('bendabus').set({
    apiKey: newKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { success: true, newKey };
});

exports.bendabusApprovePayout = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Admin requise.');
  const txId = data.txId;
  if (!txId) throw new functions.https.HttpsError('invalid-argument', 'txId manquant.');
  const txRef = db.collection('transactions').doc(txId);
  const txDoc = await txRef.get();
  if (!txDoc.exists) throw new functions.https.HttpsError('not-found', 'Transaction introuvable.');
  const tx = txDoc.data();
  if (!tx.isBendaBus || tx.payout_status !== 'pending_admin_approval') {
    throw new functions.https.HttpsError('failed-precondition', 'Transaction non éligible au reversement manuel.');
  }
  await txRef.update({
    payout_status: 'processing',
    payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  try {
    await triggerBendaBusPayout(txId, tx);
    return { success: true };
  } catch (err) {
    console.error("Manual BendaBus payout failed:", err);
    throw new functions.https.HttpsError('internal', "Échec du reversement : " + err.message);
  }
});

exports.bendabusInitPayment = functions.runWith(vpcOptions).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Zola-Api-Key');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed', code: 405 });

  try {
    const apiKey = req.header('X-Zola-Api-Key');
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key', code: 401 });
    const partnerDoc = await db.collection('partners').doc('bendabus').get();
    if (!partnerDoc.exists || partnerDoc.data().apiKey !== apiKey) {
      return res.status(401).json({ error: 'Invalid API Key', code: 401 });
    }
    
    const { merchantReference, amount, currency, allowedMethod, callbackUrl } = req.body;
    if (!merchantReference || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required parameters', code: 400 });
    }
    
    const partnerConfig = partnerDoc.data();
    const amountVal = parseFloat(amount);
    const feeAmount = parseFloat((amountVal * 0.095).toFixed(2));
    const payoutAmount = parseFloat((amountVal - feeAmount).toFixed(2));
    
    const txRef = db.collection('transactions').doc();
    await txRef.set({
      reference: txRef.id,
      merchantReference: merchantReference,
      montant: amountVal,
      currency: currency || 'USD',
      feeAmount: feeAmount,
      payoutAmount: payoutAmount,
      type: 'Paiement Partenaire BendaBus',
      statut: 'en_attente',
      isBendaBus: true,
      partnerCallbackUrl: callbackUrl || 'https://api.bendabus.com/api/payments/callback',
      allowedMethod: allowedMethod || 'ALL',
      partnerConfig: {
        payoutPhone: partnerConfig.payoutPhone || '',
        payoutNetwork: partnerConfig.payoutNetwork || '',
        autoPayout: partnerConfig.autoPayout || false
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const checkoutUrl = `https://zolamoneytrans.com/smart_pay.html?txId=${txRef.id}`;
    return res.status(200).json({
      success: true,
      transactionId: txRef.id,
      checkoutUrl: checkoutUrl,
      amount: amountVal,
      currency: currency,
      fee: feeAmount
    });
  } catch (err) {
    console.error("Error in bendabusInitPayment:", err);
    return res.status(500).json({ error: 'Internal Server Error', code: 500 });
  }
});

async function handleBendaBusCallback(txId, tx) {
  let mappedStatus = 'PENDING';
  if (tx.statut === 'succès') mappedStatus = 'PAID';
  else if (tx.statut === 'échoué') mappedStatus = 'FAILED';
  else if (tx.statut === 'annulé') mappedStatus = 'CANCELLED';
  else if (tx.statut === 'expiré') mappedStatus = 'EXPIRED';

  const payload = {
    eventId: `PAY-${txId}-${mappedStatus}`,
    merchantReference: tx.merchantReference,
    providerReference: tx.reference || txId,
    status: mappedStatus,
    amount: tx.montant,
    currency: tx.currency || 'USD',
    paymentMethod: tx.paymentMethod || 'UNKNOWN',
    sourcePlatform: 'API_PARTENAIRE',
    paidAt: new Date().toISOString()
  };

  try {
    const cbUrl = tx.partnerCallbackUrl || 'https://api.bendabus.com/api/payments/callback';
    const resp = await fetch(cbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Benda-Callback-Token': 'Xmaler895XtpLhfhf55Ka0086!jgkLL@hgytkg--'
      },
      body: JSON.stringify(payload)
    });
    console.log(`[BendaBus] Callback sent for ${txId} with status ${mappedStatus}, response: ${resp.status}`);
  } catch (err) {
    console.error(`[BendaBus] Callback failed for ${txId}:`, err.message);
  }

  // Handle Payout if PAID
  if (mappedStatus === 'PAID' && !tx.payout_status) {
    if (tx.partnerConfig && tx.partnerConfig.autoPayout) {
      await db.collection('transactions').doc(txId).update({
        payout_status: 'processing',
        payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await triggerBendaBusPayout(txId, tx);
    } else {
      await db.collection('transactions').doc(txId).update({
        payout_status: 'pending_admin_approval'
      });
    }
  }
}

async function triggerBendaBusPayout(txId, tx) {
  await db.collection('transactions').doc(txId).update({
    payout_status: 'completed',
    payoutCompletedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  await db.collection('payouts').add({
    transactionId: txId,
    partner: 'bendabus',
    amount: tx.payoutAmount,
    currency: tx.currency,
    phone: tx.partnerConfig?.payoutPhone || '',
    network: tx.partnerConfig?.payoutNetwork || '',
    status: 'success',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// ─── ZOLA GENERIC APIs INTEGRATION ───

exports.zolaApiApprovePayout = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Admin requise.');
  const txId = data.txId;
  if (!txId) throw new functions.https.HttpsError('invalid-argument', 'txId manquant.');
  const txRef = db.collection('transactions').doc(txId);
  const txDoc = await txRef.get();
  if (!txDoc.exists) throw new functions.https.HttpsError('not-found', 'Transaction introuvable.');
  const tx = txDoc.data();
  if (!tx.isZolaApi || tx.payout_status !== 'pending_admin_approval') {
    throw new functions.https.HttpsError('failed-precondition', 'Transaction non éligible au reversement manuel.');
  }
  await txRef.update({
    payout_status: 'processing',
    payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  try {
    await triggerZolaApiPayout(txId, tx);
    return { success: true };
  } catch (err) {
    console.error("Manual ZolaApi payout failed:", err);
    throw new functions.https.HttpsError('internal', "Échec du reversement : " + err.message);
  }
});

exports.zolaApiInitPayment = functions.runWith(vpcOptions).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Zola-Api-Key');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed', code: 405 });

  try {
    const apiKey = req.header('X-Zola-Api-Key');
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key', code: 401 });
    const clientsSnap = await db.collection('api_clients').where('apiKey', '==', apiKey).limit(1).get();
    if (clientsSnap.empty) {
      return res.status(401).json({ error: 'Invalid API Key', code: 401 });
    }
    const partnerDoc = clientsSnap.docs[0];
    const partnerConfig = partnerDoc.data();
    const partnerId = partnerDoc.id;
    
    const { merchantReference, amount, currency, allowedMethod } = req.body;
    if (!merchantReference || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required parameters', code: 400 });
    }
    
    const amountVal = parseFloat(amount);
    const feePct = partnerConfig.feePercentage !== undefined ? parseFloat(partnerConfig.feePercentage) : 9.5;
    const feeAmount = parseFloat((amountVal * (feePct / 100)).toFixed(2));
    const payoutAmount = parseFloat((amountVal - feeAmount).toFixed(2));
    
    const txRef = db.collection('transactions').doc();
    await txRef.set({
      reference: txRef.id,
      merchantReference: merchantReference,
      montant: amountVal,
      currency: currency || 'USD',
      feeAmount: feeAmount,
      payoutAmount: payoutAmount,
      type: 'Paiement API Partenaire',
      statut: 'en_attente',
      isZolaApi: true,
      partnerId: partnerId,
      partnerName: partnerConfig.name || 'API Partner',
      partnerCallbackUrl: partnerConfig.webhookUrl || '',
      allowedMethod: allowedMethod || 'ALL',
      partnerConfig: {
        payoutPhone: partnerConfig.payoutPhone || '',
        payoutNetwork: partnerConfig.payoutNetwork || '',
        autoPayout: partnerConfig.autoPayout || false
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Redirecting to smart_pay instead of pay.html because smart_pay handles txId now
    const checkoutUrl = `https://zolamoneytrans.com/smart_pay.html?txId=${txRef.id}`;
    return res.status(200).json({
      success: true,
      transactionId: txRef.id,
      checkoutUrl: checkoutUrl,
      amount: amountVal,
      currency: currency,
      fee: feeAmount,
      feePercentage: feePct
    });
  } catch (err) {
    console.error("Error in zolaApiInitPayment:", err);
    return res.status(500).json({ error: 'Internal Server Error', code: 500 });
  }
});

async function handleZolaApiCallback(txId, tx) {
  let mappedStatus = 'PENDING';
  if (tx.statut === 'succès') mappedStatus = 'PAID';
  else if (tx.statut === 'échoué') mappedStatus = 'FAILED';
  else if (tx.statut === 'annulé') mappedStatus = 'CANCELLED';
  else if (tx.statut === 'expiré') mappedStatus = 'EXPIRED';

  const payload = {
    eventId: `PAY-${txId}-${mappedStatus}`,
    merchantReference: tx.merchantReference,
    providerReference: tx.reference || txId,
    status: mappedStatus,
    amount: tx.montant,
    currency: tx.currency || 'USD',
    paymentMethod: tx.paymentMethod || 'UNKNOWN',
    sourcePlatform: 'ZOLA_MONEY',
    paidAt: new Date().toISOString()
  };

  try {
    const cbUrl = tx.partnerCallbackUrl;
    if (cbUrl) {
      const resp = await fetch(cbUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Zola-Callback-Token': tx.partnerId
        },
        body: JSON.stringify(payload)
      });
      console.log(`[ZolaApi] Callback sent for ${txId} with status ${mappedStatus}, response: ${resp.status}`);
    }
  } catch (err) {
    console.error(`[ZolaApi] Callback failed for ${txId}:`, err.message);
  }

  // Handle Payout if PAID
  if (mappedStatus === 'PAID' && !tx.payout_status) {
    if (tx.partnerConfig && tx.partnerConfig.autoPayout) {
      await db.collection('transactions').doc(txId).update({
        payout_status: 'processing',
        payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await triggerZolaApiPayout(txId, tx);
    } else {
      await db.collection('transactions').doc(txId).update({
        payout_status: 'pending_admin_approval'
      });
    }
  }
}

async function triggerZolaApiPayout(txId, tx) {
  await db.collection('transactions').doc(txId).update({
    payout_status: 'completed',
    payoutCompletedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  await db.collection('payouts').add({
    transactionId: txId,
    partner: tx.partnerId,
    partnerName: tx.partnerName || 'Zola API Partner',
    amount: tx.payoutAmount,
    currency: tx.currency,
    phone: tx.partnerConfig?.payoutPhone || '',
    network: tx.partnerConfig?.payoutNetwork || '',
    status: 'success',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

exports.notifyAdminOnRegistration = functions.auth.user().onCreate(async (user) => {
  try {
    const maliciousEmails = [
      'admin2@zola.tech',
      'tapifi7547@jctoto.com',
      'securitytest@test.com',
      'xalverify_ctl@agentmail.to',
      'xalgotest@agentmail.to',
      'xalgotest_ma3@agentmail.to',
      'xalgorix_test2@agentmail.to',
      'verifier_independent_test@agentmail.to'
    ];

    const isMalicious = user.email && (maliciousEmails.includes(user.email.toLowerCase()) || user.email.toLowerCase().endsWith('@agentmail.to'));

    if (isMalicious) {
      // 1. Immediately disable the account
      try {
        await admin.auth().updateUser(user.uid, { disabled: true });
      } catch (e) {
        console.error('Failed to disable malicious user:', e);
      }

      // 2. Alert the Admin with a CRITICAL email
      const alertHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #2b0000; color: #F1F0F6; border-radius: 16px; border: 1px solid red;">
          <h2 style="color: #ff4d4d; text-align: center;">⚠️ ALERTE DE SÉCURITÉ CRITIQUE ⚠️</h2>
          <p>Un attaquant connu a tenté de créer un nouveau compte sur Zola Money Trans.</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 20px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #550000;">Email:</td><td style="padding: 8px; border-bottom: 1px solid #550000;"><strong>${user.email}</strong></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #550000;">UID:</td><td style="padding: 8px; border-bottom: 1px solid #550000;">${user.uid}</td></tr>
            <tr><td style="padding: 8px;">Action Prise:</td><td style="padding: 8px; color: #ff4d4d;"><strong>COMPTE BLOQUÉ AUTOMATIQUEMENT</strong></td></tr>
          </table>
        </div>
      `;
      await sendEmailWithNodemailer({
        to: (process.env.SMTP_EMAIL || 'zolamoneytrans@gmail.com') + ', drnduwa@gmail.com',
        subject: '🚨 ALERTE CRITIQUE : Inscription d\'un attaquant bloquée',
        html: alertHtml
      });

      return; // Stop execution so they don't get the welcome email
    }

    const htmlContent = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0f0a1e; color: #F1F0F6; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);">
        <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 24px;">
          <h2 style="color: #F59E0B; margin: 0; font-size: 24px; font-weight: 700;">Zola Money Trans</h2>
          <p style="color: #A89FC0; margin: 6px 0 0 0; font-size: 14px;">Notification Administrative</p>
        </div>
        <div style="background-color: rgba(255,255,255,0.04); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
          <h3 style="color: #7C3AED; margin-top: 0; font-size: 20px; font-weight: 700; border-left: 4px solid #7C3AED; padding-left: 12px; margin-bottom: 20px;">
            Nouveau Client Inscrit
          </h3>
          <p style="font-size: 15px; line-height: 1.6; color: #F1F0F6; margin-bottom: 20px;">
            Un nouvel utilisateur vient de créer son compte sur la plateforme Zola Money Trans.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
              <td style="padding: 12px 0; color: #A89FC0; width: 35%;">Nom / Pseudo</td>
              <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${user.displayName || 'Non renseigné'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
              <td style="padding: 12px 0; color: #A89FC0;">Email</td>
              <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${user.email || 'Non renseigné'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
              <td style="padding: 12px 0; color: #A89FC0;">Téléphone</td>
              <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${user.phoneNumber || 'Non renseigné'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
              <td style="padding: 12px 0; color: #A89FC0;">ID Utilisateur (UID)</td>
              <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #9B59F5; font-family: monospace; font-size: 13px;">${user.uid}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #A89FC0;">Date d'inscription</td>
              <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}</td>
            </tr>
          </table>
        </div>
        <div style="text-align: center; margin-top: 24px; font-size: 13px; color: #6B5F85;">
          Gérez cet utilisateur depuis votre <a href="https://zolamoneytransmarchand.web.app/admin.html" style="color: #9B59F5; text-decoration: none; font-weight: 600;">Tableau de bord Admin</a>.
        </div>
      </div>
    `;

    await sendEmailWithNodemailer({
      to: (process.env.SMTP_EMAIL || 'zolamoneytrans@gmail.com') + ', drnduwa@gmail.com',
      subject: '✨ Nouvel utilisateur inscrit sur Zola Money Trans !',
      html: htmlContent
    });

    // Send Welcome Email to the User
    if (user.email && user.email.includes('@')) {
      const welcomeHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0f0a1e; color: #F1F0F6; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);">
          <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 24px;">
            <h2 style="color: #F59E0B; margin: 0; font-size: 24px; font-weight: 700;">Bienvenue sur Zola Money Trans !</h2>
          </div>
          <div style="background-color: rgba(255,255,255,0.04); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
            <p style="font-size: 16px; line-height: 1.6; color: #F1F0F6;">
              Bonjour ${user.displayName || 'Cher(e) client(e)'},
            </p>
            <p style="font-size: 15px; line-height: 1.6; color: #A89FC0;">
              Nous sommes ravis de vous compter parmi nous ! <strong>Zola Money Trans</strong> est votre plateforme de transfert d'argent fiable, rapide et sécurisée. 
              Notre mission est de faciliter vos transactions financières au quotidien, que ce soit pour envoyer de l'argent à vos proches ou pour régler vos paiements en toute simplicité.
            </p>
            
            <p style="font-size: 15px; line-height: 1.6; color: #A89FC0; margin-top: 20px;">
              Pour profiter pleinement de nos services, nous vous invitons à télécharger notre application mobile ou à consulter nos tutoriels :
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://play.google.com/store/apps/details?id=com.zolamoneytrans.app" style="display: inline-block; background-color: #7C3AED; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 10px;">
                📱 Télécharger sur Playstore
              </a>
              <a href="https://youtube.com/@zolamoneytrans?si=XWizR7wZOA4w4wnr" style="display: inline-block; background-color: #FF0000; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 10px;">
                ▶️ Notre chaîne YouTube
              </a>
            </div>

            <p style="font-size: 15px; line-height: 1.6; color: #A89FC0; margin-top: 20px;">
              Si vous avez des questions, notre équipe de support est là pour vous aider.
            </p>
            
            <p style="font-size: 15px; line-height: 1.6; color: #F1F0F6; font-weight: 600; margin-top: 30px;">
              L'équipe Zola Money Trans
            </p>
          </div>
        </div>
      `;

      await sendEmailWithNodemailer({
        to: user.email,
        subject: '🎉 Bienvenue sur Zola Money Trans !',
        html: welcomeHtml
      });
    }
  } catch (error) {
    console.error('[Registration Email Error] Failed to send email:', error);
  }
});

exports.onTransactionWrite = functions.firestore.document('transactions/{txId}').onWrite(async (change, context) => {
  const before = change.before ? change.before.data() : null;
  const after = change.after ? change.after.data() : null;

  if (!after) return; // Document deleted

  const statusBefore = before ? before.statut : null;
  const statusAfter = after.statut;

  const isNewFinalized = !before && (statusAfter === 'succès' || statusAfter === 'échoué');
  const isStatusChangedToFinal = before && statusBefore !== statusAfter && (statusAfter === 'succès' || statusAfter === 'échoué');
  const isStatusChanged = before && statusBefore !== statusAfter;

  if (after.isBendaBus && (!before || isStatusChanged)) {
    try {
      await handleBendaBusCallback(context.params.txId, after);
    } catch (err) {
      console.error('[onTransactionWrite] BendaBus callback error:', err);
    }
  }

  if (after.isZolaApi && (!before || isStatusChanged)) {
    try {
      await handleZolaApiCallback(context.params.txId, after);
    } catch (err) {
      console.error('[onTransactionWrite] ZolaApi callback error:', err);
    }
  }

  if (isNewFinalized || isStatusChangedToFinal) {
    // ── Garantie Payout Autonome : transfert inter-opérateur ──
    if (statusAfter === 'succès' && after.isTransfer && !after.payOutInitiated) {
      try {
        await triggerAutonomousTransferPayout(change.after.ref, after);
      } catch (errAuto) {
        console.error('[onTransactionWrite] Autonomous payout error:', errAuto);
      }
    }

    // ── Garantie Payout Marchand : reversement automatique vers le compte mobile configuré en cas de paiement QR / Invité ──
    if (statusAfter === 'succès' && (after.isGuestPayment || after.type === 'Paiement QR Invité Reçu') && !after.payOutInitiated && !after.settlementInitiated) {
      try {
        await triggerAutonomousMerchantPayout(change.after.ref, after);
      } catch (errAutoM) {
        console.error('[onTransactionWrite] Autonomous merchant payout error:', errAutoM);
      }
    }

    // ── Confirmation de Livraison Finale (PayOut réussi) ──
    if (statusAfter === 'succès' && after.parentReference && after.userId) {
      try {
        await db.collection('notifications').add({
          userId: after.userId,
          type: 'transfer_delivered',
          title: '✅ Transfert délivré au bénéficiaire !',
          message: `Votre transfert de ${after.montant} ${after.currency} vers le numéro ${after.beneficiaire || after.beneficiaryNumber} (${after.operateur}) a été confirmé et déposé sur le compte du bénéficiaire.`,
          reference: after.parentReference,
          outReference: after.reference,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (errNotif) {
        console.warn('[onTransactionWrite] Failed to write delivery notification:', errNotif);
      }
    }

    try {
      const txId = context.params.txId;
      
      // Fetch user profile to get complete details
      let userName = 'Client Inconnu';
      let userPhone = 'Non renseigné';
      let userEmail = after.userEmail || 'Non renseigné';

      if (after.userId) {
        try {
          const userDoc = await db.collection('users').doc(after.userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            userName = userData.name || userData.displayName || userName;
            userPhone = userData.phone || userData.phoneNumber || userPhone;
            userEmail = userData.email || userEmail;
          }
        } catch (errUser) {
          console.warn('[Transaction Email] Failed to fetch user details:', errUser);
        }
      }

      const isSuccess = statusAfter === 'succès';
      const statusColor = isSuccess ? '#10B981' : '#EF4444';
      const statusLabel = isSuccess ? 'RÉUSSIE' : 'ÉCHOUÉE';
      const statusIcon = isSuccess ? '🟢' : '🔴';

      const htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0f0a1e; color: #F1F0F6; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);">
          <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 24px;">
            <h2 style="color: #F59E0B; margin: 0; font-size: 24px; font-weight: 700;">Zola Money Trans</h2>
            <p style="color: #A89FC0; margin: 6px 0 0 0; font-size: 14px;">Notification Administrative de Transaction</p>
          </div>
          <div style="background-color: rgba(255,255,255,0.04); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
            <h3 style="color: ${statusColor}; margin-top: 0; font-size: 20px; font-weight: 700; border-left: 4px solid ${statusColor}; padding-left: 12px; margin-bottom: 20px;">
              Transaction ${statusLabel} ${statusIcon}
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0; width: 35%;">ID Transaction (Firestore)</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${txId}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Référence Externe</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${after.reference}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Partenaire ID / Tx UUID</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${after.transactionId || '—'}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Type</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${after.type}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Montant</td>
                <td style="padding: 12px 0; font-weight: 700; text-align: right; color: #9B59F5; font-size: 16px;">${after.montant} ${after.currency}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Opérateur / Méthode</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6; text-transform: uppercase;">${after.operateur || '—'}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Description</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${after.description || '—'}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Nom du Client</td>
                <td style="padding: 12px 0; font-weight: 700; text-align: right; color: #FCD34D;">${userName}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Téléphone du Client</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${userPhone}</td>
              </tr>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                <td style="padding: 12px 0; color: #A89FC0;">Email du Client</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #F1F0F6;">${userEmail}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #A89FC0;">UID Client</td>
                <td style="padding: 12px 0; font-weight: 600; text-align: right; color: #9B59F5; font-family: monospace; font-size: 13px;">${after.userId}</td>
              </tr>
            </table>
          </div>
          <div style="text-align: center; margin-top: 24px; font-size: 13px; color: #6B5F85;">
            Cette notification automatique est gérée par le déclencheur de base de données Firestore Zola Pay.
          </div>
        </div>
      `;

      // Générer le PDF en mémoire
      let pdfBuffer = null;
      try {
        pdfBuffer = await generateReceiptPDF(after, userName, txId);
      } catch (e) {
        console.error('[PDF Generation] Failed:', e);
      }

      const attachments = [];
      if (pdfBuffer) {
        attachments.push({
          filename: `Zola_Recu_${after.reference || txId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        });
      }

      const emailSubject = `${isSuccess ? '🟢' : '🔴'} Transaction ${statusLabel} - ${after.montant} ${after.currency}`;

      // 1. Envoyer la notification à l'Administrateur
      try {
        await sendEmailWithNodemailer({
          to: (process.env.SMTP_EMAIL || 'zolamoneytrans@gmail.com') + ', drnduwa@gmail.com',
          subject: `${emailSubject} - ${userName}`,
          html: htmlContent,
          attachments: attachments
        });
      } catch (errAdmin) {
        console.error('[Admin Email Error]:', errAdmin);
      }

      // 2. Envoyer les emails finaux (Client et Marchand) seulement à la fin (Pas de notification prématurée)
      const triggersPayout = after.isTransfer || after.isGuestPayment || after.type === 'Paiement QR Invité Reçu' || after.type === 'card_deposit';

      if (isSuccess && triggersPayout && !after.parentReference) {
        // Skip email for PayIn that triggers PayOut to avoid premature confirmation
        console.log(`[Email] Skipping early success email for PayIn ${txId} because it triggers a PayOut.`);
        return;
      }

      let parentTx = null;
      if (after.parentReference) {
        try {
          const parentSnap = await db.collection('transactions').where('reference', '==', after.parentReference).limit(1).get();
          if (!parentSnap.empty) {
            parentTx = parentSnap.docs[0].data();
          }
        } catch (e) {
          console.warn('[Transaction Email] Failed to fetch parent transaction:', e);
        }
      }

      const payerNameFinal = parentTx?.payerName || userName;
      const payerPhoneFinal = parentTx?.customerNumber || parentTx?.expediteur || userPhone;
      const payerEmailFinal = parentTx?.payerEmail || (after.parentReference ? '' : userEmail);
      const exactAmountPayer = parentTx ? `${parentTx.montant || parentTx.amount} ${parentTx.currency}` : `${after.montant} ${after.currency}`;
      const exactAmountMerchant = parentTx ? `${parentTx.amountBase || parentTx.amountNet || parentTx.montant || parentTx.amount} ${parentTx.currency}` : `${after.montant} ${after.currency}`;
      const exactPurpose = parentTx?.description || after.description || 'Paiement / Transfert';

      // 2a. Envoyer le reçu au Client / Payeur
      if (payerEmailFinal && payerEmailFinal.includes('@')) {
        let clientSubject = emailSubject;
        let clientMessage = `Votre transaction de <strong>${exactAmountPayer}</strong> a été ${isSuccess ? 'effectuée avec succès' : 'rejetée'}.`;

        if (after.parentReference && !isSuccess) {
          // Ne pas envoyer d'e-mail de "rejet" au payeur si c'est le PayOut qui a échoué (car son PayIn a réussi)
          console.log(`[Email] Skipping failure email to payer for PayOut ${txId} parce que le PayIn a réussi.`);
        } else {
          if (after.parentReference && isSuccess) {
            clientSubject = `✅ Transfert Délivré au Bénéficiaire ! - ${exactAmountPayer}`;
            clientMessage = `🎉 <strong>Félicitations !</strong> Votre transfert de <strong>${exactAmountPayer}</strong> vers le numéro <strong>${after.beneficiaire || after.beneficiaryNumber}</strong> (${after.operateur}) a été exécuté et déposé avec succès sur le compte du bénéficiaire.`;
          }

          const clientHtml = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 24px; border-radius: 12px; border: 1px solid #eee;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #7C3AED; margin: 0;">Zola Money Trans</h2>
              </div>
              <h3 style="color: #1e1b4b;">Bonjour ${payerNameFinal},</h3>
              <p style="font-size: 15px; line-height: 1.6; color: #374151;">${clientMessage}</p>
              <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 14px;"><strong>Montant exact :</strong> <span style="color: #10B981; font-weight: bold;">${exactAmountPayer}</span></p>
                <p style="margin: 8px 0 0; font-size: 14px;"><strong>Motif :</strong> ${exactPurpose}</p>
              </div>
              <p style="margin-top: 20px;">Veuillez trouver ci-joint votre reçu de transaction en format PDF.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
              <p style="font-size: 12px; color: #6b7280; text-align: center;">L'équipe Zola Money Trans<br/>support@zolamoneytrans.com | www.zolamoneytrans.com</p>
            </div>
          `;
          try {
            await sendEmailWithNodemailer({
              to: payerEmailFinal,
              subject: clientSubject,
              html: clientHtml,
              attachments: attachments
            });
          } catch (errClient) {
            console.error('[Client Email Error]:', errClient);
          }
        }
      }

      // 2b. Envoyer la notification au Bénéficiaire / Marchand
      if (after.parentReference && isSuccess && userEmail && userEmail.includes('@')) {
        const merchantSubject = `💰 Nouveau paiement reçu - ${exactAmountMerchant}`;
        const merchantHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 24px; border-radius: 12px; border: 1px solid #eee;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #7C3AED; margin: 0;">Zola Money Trans</h2>
            </div>
            <h3 style="color: #1e1b4b;">Bonjour ${userName},</h3>
            <p style="font-size: 15px; line-height: 1.6; color: #374151;">Vous avez reçu un nouveau paiement avec succès ! Les fonds ont été déposés sur votre compte mobile money.</p>
            
            <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
              <h4 style="margin-top: 0; color: #4C1D95; font-size: 16px;">Détails de la transaction</h4>
              <p style="margin: 8px 0; font-size: 14px;"><strong>Montant exact :</strong> <span style="color: #10B981; font-weight: bold;">${exactAmountMerchant}</span></p>
              <p style="margin: 8px 0; font-size: 14px;"><strong>Motif :</strong> ${exactPurpose}</p>
            </div>

            <div style="background: #ffffff; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
              <h4 style="margin-top: 0; color: #4C1D95; font-size: 16px;">Contact de l'expéditeur</h4>
              <p style="margin: 8px 0; font-size: 14px;"><strong>Nom :</strong> ${payerNameFinal}</p>
              <p style="margin: 8px 0; font-size: 14px;"><strong>Téléphone :</strong> ${payerPhoneFinal}</p>
              ${payerEmailFinal ? `<p style="margin: 8px 0; font-size: 14px;"><strong>Email :</strong> <a href="mailto:${payerEmailFinal}">${payerEmailFinal}</a></p>` : ''}
            </div>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"/>
            <p style="font-size: 12px; color: #6b7280; text-align: center;">L'équipe Zola Money Trans<br/>support@zolamoneytrans.com | www.zolamoneytrans.com</p>
          </div>
        `;
        try {
          await sendEmailWithNodemailer({
            to: userEmail,
            subject: merchantSubject,
            html: merchantHtml,
            attachments: attachments
          });
        } catch (errMerchant) {
          console.error('[Merchant Email Error]:', errMerchant);
        }
      }
    } catch (errTx) {
      console.error('[Transaction Routine Error] Failed:', errTx);
    }
  }
});

// ═══════════════════════════════════════════════════════════
// HTTP ENDPOINT — processCardCheckout — Paiement CB & Payout
// ═══════════════════════════════════════════════════════════
exports.processCardCheckout = functions.runWith(vpcOptions).https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Méthode non autorisée.' });
      }

      const { agentCode, amount, baseAmt, currency, bank, cardHolder, reference, txId } = req.body || {};
      if (!agentCode || !amount) {
        return res.status(400).json({ success: false, message: 'Paramètres manquants.' });
      }

      const payinAmount = parseFloat(amount) || 0;
      const payoutAmount = baseAmt !== undefined && baseAmt !== null ? parseFloat(baseAmt) : Number((payinAmount / 1.095).toFixed(2));
      const commVal = Number((payoutAmount * 0.015).toFixed(2));
      const curr = currency || 'USD';

      // 1. Chercher l'Agent dans Firestore
      const agentQuery = await db.collection('agents').where('agentCode', '==', agentCode).limit(1).get();
      let agentUid = 'marchand';
      let agentPhone = '0820000000';
      let agentOperator = 'mpesa';
      let currentTotal = 0;
      let currentPending = 0;

      if (!agentQuery.empty) {
        const docSnap = agentQuery.docs[0];
        agentUid = docSnap.id;
        const data = docSnap.data();
        agentPhone = data.mmPhone || data.phone || '0820000000';
        agentOperator = data.selectedOperator || 'mpesa';
        currentTotal = (data.commissions && data.commissions.total) || 0;
        currentPending = (data.commissions && data.commissions.pending) || 0;
      }

      const refIn = reference || ('CB_' + Date.now());

      // VERROU ANTI DOUBLE-PAIEMENT
      if (reference) {
        const existingTxSnap = await db.collection('transactions').where('reference', '==', reference).get();
        if (!existingTxSnap.empty) {
          if (txId) {
            const existingDoc = existingTxSnap.docs.find(d => d.id === txId);
            if (!existingDoc) {
              return res.status(400).json({ success: false, message: 'Transaction mismatch.' });
            }
            if (existingDoc.data().statut !== 'en_attente' && existingDoc.data().status !== 'pending') {
              return res.status(400).json({ success: false, message: 'Cette transaction a déjà été traitée.' });
            }
            // Ensure method allowed restriction is respected
            const allowed = existingDoc.data().allowedMethod || 'ALL';
            if (allowed === 'MOBILE_MONEY') {
              return res.status(403).json({ success: false, message: 'Mode de paiement non autorisé (Bank Card interdit).' });
            }
          } else {
            const isProcessing = existingTxSnap.docs.some(doc => ['en_attente', 'succès', 'en_traitement', 'pending'].includes(doc.data().statut) || doc.data().status === 'pending');
            if (isProcessing) {
              return res.status(400).json({ success: false, message: 'Une transaction avec cette référence est déjà en cours ou terminée. (Double paiement évité)' });
            }
          }
        }
      }

      // 2. ÉTAPE 1 : Création de la session de paiement Moko Africa / CyberSource (FreshPay Visa platform)
      let mokoRes = null;
      try {
        mokoRes = await mokoCardRequest({
          amount: payinAmount,
          currency: curr,
          merchant_reference: refIn,
          bill_to_forename: (cardHolder || 'Client').split(' ')[0] || 'Client',
          bill_to_surname: (cardHolder || 'Client').split(' ').slice(1).join(' ') || 'CB',
          bill_to_email: 'checkout@zolamoneytrans.com',
          bill_to_phone: formatPhoneLocal(agentPhone),
          bill_to_address_line1: "Kinshasa",
          bill_to_address_city: "Kinshasa",
          bill_to_address_state: "Kin",
          bill_to_address_postal_code: "0000",
          bill_to_address_country: "CD",
          callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`,
          return_url: `https://zolamoneytransmarchand.web.app/cb_success.html?ref=${refIn}`,
          cancel_url: `https://zolamoneytransmarchand.web.app/cb_checkout.html?cancel=true&ref=${refIn}`
        });
      } catch (mokoErr) {
        console.error('MokoAfrica PayIn Init Error:', mokoErr);
        return res.status(400).json({
          success: false,
          message: "Erreur lors de l'initialisation du paiement carte FreshPay : " + (mokoErr.message || "Erreur passerelle.")
        });
      }

      // 3. Enregistrement transaction Firestore en attente de validation OTP par la banque
      const txData = {
        agentUid: agentUid,
        agentCode: agentCode,
        type: 'card_deposit',
        action: 'credit',
        bank: bank || 'Visa/Mastercard',
        cardHolder: cardHolder || 'CLIENT CB',
        amount: payinAmount,
        amountNet: payoutAmount,
        amountOriginal: payinAmount,
        currencyOriginal: curr,
        agentCommission: commVal,
        status: 'pending',
        statut: 'en_attente',
        reference: refIn,
        payoutPhone: agentPhone,
        payoutOperator: agentOperator,
        payOutInitiated: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (txId) {
        await db.collection('transactions').doc(txId).update({
          agentUid: agentUid,
          agentCode: agentCode,
          bank: bank || 'Visa/Mastercard',
          cardHolder: cardHolder || 'CLIENT CB',
          status: 'pending',
          isCardPayment: true,
          payOutInitiated: false
        });
      } else {
        await db.collection('transactions').add(txData);
      }

      // 4. Extraction de l'URL de paiement FreshPay / CyberSource pour rediriger le client vers la saisie carte & OTP
      let paymentUrl = null;
      if (mokoRes) {
        paymentUrl = mokoRes.data?.payment_url || mokoRes.data?.checkout_url || mokoRes.data?.url || mokoRes.data?.link ||
                     mokoRes.payment_url || mokoRes.checkout_url || mokoRes.url || mokoRes.link ||
                     (typeof mokoRes.data?.links === 'string' ? mokoRes.data.links : null) ||
                     mokoRes.data?.links?.checkout || mokoRes.data?.links?.payment ||
                     mokoRes.data?.links?.checkout?.href;
      }
      if (!paymentUrl) {
        paymentUrl = `https://secureacceptance.cybersource.com/billing?ref=${refIn}&amount=${payinAmount}&currency=${curr}`;
      }

      return res.status(200).json({
        success: true,
        status: 'redirect',
        paymentUrl: paymentUrl,
        reference: refIn,
        transactionId: mokoRes?.data?.transaction_uuid || 'MOKO_N/A'
      });
    } catch (err) {
      console.error('processCardCheckout Error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// HTTP ENDPOINT — verifyAndTriggerCardPayout — Vérification et PayOut CB
// ═══════════════════════════════════════════════════════════
exports.verifyAndTriggerCardPayout = functions.runWith(vpcOptions).https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      const ref = req.query.ref || req.body?.ref;
      if (!ref) {
        return res.status(400).json({ success: false, message: 'Référence manquante.' });
      }

      const snap = await db.collection('transactions').where('reference', '==', ref).limit(1).get();
      if (snap.empty) {
        return res.status(404).json({ success: false, message: 'Transaction introuvable.' });
      }

      const txDoc = snap.docs[0];
      const tx = txDoc.data();

      if (tx.type !== 'card_deposit') {
        return res.status(400).json({ success: false, message: 'Type de transaction invalide.' });
      }

      let shouldInitiate = false;
      try {
        shouldInitiate = await db.runTransaction(async (t) => {
          const docSnap = await t.get(txDoc.ref);
          if (!docSnap.exists) return false;
          const data = docSnap.data();
          if (data.payOutInitiated || data.freshpayOutRef) return false;
          t.update(txDoc.ref, { payOutInitiated: true });
          return true;
        });
      } catch (txErr) {
        console.error('[verifyAndTriggerCardPayout] Firestore tx error:', txErr);
      }

      if (!shouldInitiate) {
        return res.status(200).json({ success: true, message: 'PayOut déjà déclenché ou effectué.' });
      }

      const outRef = 'OUT_' + ref;
      let fpOutRes = null;
      try {
        console.log(`[verifyAndTriggerCardPayout] Déclenchement automatique du PayOut Agent pour ref ${ref}`);
        fpOutRes = await freshpayRequest({
          action: 'credit',
          amount: String(tx.amountNet || tx.amount),
          currency: tx.currencyOriginal || 'USD',
          customer_number: formatPhoneLocal(tx.payoutPhone),
          reference: outRef,
          method: normMethod(tx.payoutOperator || 'mpesa'),
          callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
        });

        await txDoc.ref.update({
          freshpayOutRef: outRef,
          status: 'confirmed',
          statut: 'succès',
          freshpayStatus: (fpOutRes && (fpOutRes.Status || fpOutRes.status)) || 'Success'
        });

        if (tx.agentUid && tx.agentUid !== 'marchand') {
          const agentRefDoc = db.collection('agents').doc(tx.agentUid);
          await db.runTransaction(async (t) => {
            const agDoc = await t.get(agentRefDoc);
            if (agDoc.exists) {
              const agData = agDoc.data();
              const curTotal = (agData.commissions && agData.commissions.total) || 0;
              const curPending = (agData.commissions && agData.commissions.pending) || 0;
              const comm = tx.agentCommission || 0;
              t.update(agentRefDoc, {
                'commissions.total': curTotal + comm,
                'commissions.pending': curPending + comm
              });
            }
          });
        }
      } catch (errOut) {
        console.error('[verifyAndTriggerCardPayout] PayOut error:', errOut);
        await txDoc.ref.update({
          payOutError: errOut.message || 'Erreur PayOut'
        });
        return res.status(500).json({ success: false, message: 'Erreur lors du PayOut : ' + errOut.message });
      }

      return res.status(200).json({
        success: true,
        message: 'PayOut déclenché avec succès !',
        freshpayOutRef: outRef
      });
    } catch (e) {
      console.error('[verifyAndTriggerCardPayout] Error:', e);
      return res.status(500).json({ success: false, message: e.message });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTIONS — SMART BROADCAST & ANNOUNCEMENTS (E-MAILS & NOTIFS)
// ═══════════════════════════════════════════════════════════
exports.adminSendBroadcast = functions.runWith({ ...vpcOptions, timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const tokenEmail = context.auth.token.email || '';
  const isAdmin = tokenEmail === 'zolamoneytrans@gmail.com' || tokenEmail === 'drnduwa@gmail.com' || tokenEmail === 'zolamoneytransmarchand@gmail.com' || context.auth.token.admin === true;
  if (!isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Accès réservé aux administrateurs de Zola Money Trans.');
  }

  const { target, targetEmail, channel, subject, messageHtml, ctaText, ctaUrl } = data;
  if (!subject || !messageHtml) {
    throw new functions.https.HttpsError('invalid-argument', 'Sujet et message requis.');
  }

  // 1. Fetch target users
  let snap = await db.collection('users').get();
  let targetUsers = [];
  snap.forEach(doc => {
    const u = doc.data();
    u.uid = doc.id;
    if (target === 'single') {
      if (u.email && targetEmail && u.email.toLowerCase() === targetEmail.toLowerCase()) {
        targetUsers.push(u);
      }
    } else if (target === 'marchands_agents') {
      if (u.role === 'marchand' || u.role === 'agent' || u.role === 'eglise' || u.role === 'entreprise' || u.kycLevel === 'marchand') {
        targetUsers.push(u);
      }
    } else if (target === 'pending_kyc') {
      if (u.kycStatus !== 'approuve') {
        targetUsers.push(u);
      }
    } else if (target === 'vip') {
      if (u.role === 'user' || u.role === 'marchand' || u.soldeCDF > 0 || u.soldeUSD > 0) {
        targetUsers.push(u);
      }
    } else {
      // 'all'
      targetUsers.push(u);
    }
  });

  if (target === 'single' && targetUsers.length === 0 && targetEmail) {
    targetUsers.push({ uid: 'single_' + Date.now(), email: targetEmail, name: 'Utilisateur Zola' });
  }

  let emailsSent = 0;
  let notificationsCreated = 0;
  let successEmails = [];
  let failedEmails = [];

  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0B0914; color: #F1F0F6; }
        .container { max-width: 600px; margin: 20px auto; background-color: #161321; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
        .header { background: linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%); padding: 30px 20px; text-align: center; border-bottom: 2px solid #F59E0B; }
        .logo { font-size: 26px; font-weight: 800; color: #F59E0B; letter-spacing: 1px; }
        .subtitle { font-size: 13px; color: #E2E8F0; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; }
        .content { padding: 32px 24px; line-height: 1.6; font-size: 15px; color: #E2E8F0; }
        .cta-box { text-align: center; margin: 30px 0 10px 0; }
        .cta-btn { display: inline-block; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #ffffff !important; padding: 14px 32px; font-weight: bold; border-radius: 30px; text-decoration: none; box-shadow: 0 10px 20px rgba(16,185,129,0.3); }
        .footer { background-color: #110E1B; padding: 20px 24px; text-align: center; font-size: 12px; color: #7E7694; border-top: 1px solid rgba(255,255,255,0.05); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">ZOLA MONEY TRANS</div>
          <div class="subtitle">Annonce & Notification Officielle</div>
        </div>
        <div class="content">
          ${messageHtml}
          ${ctaText && ctaUrl ? `<div class="cta-box"><a href="${ctaUrl}" class="cta-btn">${ctaText} →</a></div>` : ''}
        </div>
        <div class="footer">
          <p style="margin:0 0 8px 0;">© ${new Date().getFullYear()} Zola Money Trans — La Révolution Financière en RDC.</p>
          <p style="margin:0;">Vous recevez cet e-mail car vous êtes inscrit sur notre plateforme officielle.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const sendEmail = channel === 'email' || channel === 'both';
  const sendInApp = channel === 'in_app' || channel === 'both';

  const historyDocRef = db.collection('broadcast_history').doc();

  if (sendEmail) {
    const emailTasks = targetUsers.filter(u => u.email && u.email.includes('@'));
    const chunkSize = 25;
    for (let i = 0; i < emailTasks.length; i += chunkSize) {
      const chunk = emailTasks.slice(i, i + chunkSize);
      await Promise.allSettled(chunk.map(async (u) => {
        try {
          await sendEmailWithNodemailer({
            to: u.email,
            subject: `[Zola] ${subject}`,
            html: fullHtml
          });
          emailsSent++;
          successEmails.push(u.email);
        } catch (e) {
          console.error(`Error sending email to ${u.email}:`, e);
          failedEmails.push({ email: u.email, error: e.message || String(e) });
        }
      }));
    }
  }

  const historyData = {
    title: subject,
    message: messageHtml.replace(/<[^>]*>?/gm, ''),
    html: messageHtml,
    ctaText: ctaText || '',
    ctaUrl: ctaUrl || '',
    target: target,
    channel: channel,
    sentBy: tokenEmail,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    userCount: targetUsers.length,
    successEmails: successEmails,
    failedEmails: failedEmails,
    emailsSentCount: emailsSent,
    errorsCount: failedEmails.length
  };

  if (sendInApp) {
    const batch = db.batch();
    batch.set(historyDocRef, historyData);

    const maxPush = Math.min(targetUsers.length, 450);
    for (let i = 0; i < maxPush; i++) {
      const u = targetUsers[i];
      if (u.uid && !u.uid.startsWith('single_')) {
        const uNotifRef = db.collection('users').doc(u.uid).collection('notifications').doc();
        batch.set(uNotifRef, {
          title: subject,
          message: messageHtml.replace(/<[^>]*>?/gm, ''),
          ctaText: ctaText || '',
          ctaUrl: ctaUrl || '',
          read: false,
          type: 'announcement',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        notificationsCreated++;
      }
    }
    await batch.commit();
  } else {
    await historyDocRef.set(historyData);
  }

  return {
    success: true,
    historyId: historyDocRef.id,
    emailsSent,
    notificationsCreated,
    totalTargets: targetUsers.length,
    errorsCount: failedEmails.length,
    successEmails,
    failedEmails,
    message: `Diffusion terminée : ${emailsSent} e-mail(s) envoyé(s), ${failedEmails.length} échec(s), ${notificationsCreated} notification(s) in-app.`
  };
});

exports.adminGetBroadcastHistory = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const snap = await db.collection('broadcast_history').orderBy('sentAt', 'desc').limit(20).get();
  const list = [];
  snap.forEach(doc => {
    const d = doc.data();
    list.push({
      id: doc.id,
      ...d,
      sentAt: d.sentAt?.toDate ? d.sentAt.toDate().toISOString() : new Date().toISOString()
    });
  });
  return { success: true, list };
});

// ═══════════════════════════════════════════════════════════
// CALLABLE & TRIGGER FOR DIRECT OFFICIAL EMAIL SENDING
// ═══════════════════════════════════════════════════════════
exports.adminSendEmailDirect = functions.runWith({ ...vpcOptions, timeoutSeconds: 60, memory: '512MB' }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  const uid = context.auth.uid;
  const tokenEmail = context.auth.token.email || '';
  const isAdmin = tokenEmail === 'zolamoneytrans@gmail.com' || tokenEmail === 'drnduwa@gmail.com' || tokenEmail === 'zolamoneytransmarchand@gmail.com' || context.auth.token.admin === true;
  if (!isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Accès réservé aux administrateurs de Zola Money Trans.');
  }

  const { to, subject, body, html } = data;
  if (!to || !subject) {
    throw new functions.https.HttpsError('invalid-argument', 'Destinataire et sujet requis.');
  }

  const emailHtml = html || `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0f0a1e; color: #F1F0F6; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);">
    <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 24px;">
      <h2 style="color: #F59E0B; margin: 0; font-size: 24px; font-weight: 700;">Zola Money Trans</h2>
      <p style="color: #A89FC0; margin: 6px 0 0 0; font-size: 14px;">Notification Administrative</p>
    </div>
    <div style="background-color: rgba(255,255,255,0.04); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
      <h3 style="color: #7C3AED; margin-top: 0; font-size: 18px; font-weight: 700; border-left: 4px solid #7C3AED; padding-left: 12px; margin-bottom: 16px;">
        ${subject}
      </h3>
      <div style="font-size: 15px; line-height: 1.6; color: #F1F0F6; white-space: pre-wrap;">${body || ''}</div>
    </div>
    <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #6B5F85;">
      Zola Money Trans — Service Client et Supervision<br/>
      <span style="color: #A89FC0;">Ne répondez pas directement à ce courriel automatique.</span>
    </div>
  </div>`;

  try {
    await sendEmailWithNodemailer({
      to: to,
      subject: subject,
      html: emailHtml
    });

    // Log to mail collection
    await db.collection('mail').add({
      to: [to],
      message: { subject, text: body || '', html: emailHtml },
      sentBy: tokenEmail,
      delivery: { state: 'SUCCESS', time: admin.firestore.FieldValue.serverTimestamp() },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: `E-mail envoyé avec succès à ${to}.` };
  } catch (err) {
    console.error(`[adminSendEmailDirect Error] to: ${to}`, err);
    // Log failed attempt
    await db.collection('mail').add({
      to: [to],
      message: { subject, text: body || '', html: emailHtml },
      sentBy: tokenEmail,
      delivery: { state: 'ERROR', error: err.message || String(err), time: admin.firestore.FieldValue.serverTimestamp() },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    throw new functions.https.HttpsError('internal', `Erreur SMTP Nodemailer : ${err.message || String(err)}`);
  }
});

exports.onMailCreate = functions.firestore.document('mail/{mailId}').onCreate(async (snap, context) => {
  const data = snap.data();
  if (!data || !data.to || !data.message) return null;
  // If already processed or delivered directly by adminSendEmailDirect, skip
  if (data.delivery && (data.delivery.state === 'SUCCESS' || data.delivery.state === 'SENT')) return null;

  const recipients = Array.isArray(data.to) ? data.to : [data.to];
  const subject = data.message?.subject || 'Notification Zola Money Trans';
  const html = data.message?.html || `<p>${data.message?.text || ''}</p>`;

  for (const to of recipients) {
    if (!to || typeof to !== 'string' || !to.includes('@')) continue;
    try {
      await sendEmailWithNodemailer({ to, subject, html });
      await snap.ref.update({
        delivery: { state: 'SUCCESS', time: admin.firestore.FieldValue.serverTimestamp() }
      });
    } catch (error) {
      console.error(`[onMailCreate Error] Failed sending to ${to}:`, error);
      await snap.ref.update({
        delivery: { state: 'ERROR', error: error.message || String(error), time: admin.firestore.FieldValue.serverTimestamp() }
      });
    }
  }
  return null;
});

// ═══════════════════════════════════════════════════════════
// SECURITY HONEYPOT TRIGGERS
// ═══════════════════════════════════════════════════════════
const legitimateAdminEmails = ['zolamoneytrans@gmail.com', 'drnduwa@gmail.com', 'zolamoneytransmarchand@gmail.com'];

exports.securityHoneypotTriggerUsers = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const after = change.after.data();
    if (!after) return null;
    
    const userId = context.params.userId;
    const maliciousAdmin = after.admin === true || after.role === 'admin';
    
    if (maliciousAdmin && !legitimateAdminEmails.includes(after.email)) {
      console.warn(`[SECURITY] Malicious privilege escalation attempt by user ${userId}`);
      try { await admin.auth().deleteUser(userId); } catch (e) {}
      await db.collection('security_logs').add({
        type: 'PRIVILEGE_ESCALATION_ATTEMPT',
        userId: userId,
        email: after.email,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        description: 'User attempted to grant themselves admin privileges and was automatically terminated.',
        severity: 'CRITICAL'
      });
      await change.after.ref.delete();
    }
  });

exports.securityHoneypotTriggerAgents = functions.firestore
  .document('agents/{userId}')
  .onWrite(async (change, context) => {
    const after = change.after.data();
    if (!after) return null;
    
    const userId = context.params.userId;
    const maliciousAdmin = after.admin === true || after.role === 'admin';
    
    if (maliciousAdmin && !legitimateAdminEmails.includes(after.email)) {
      console.warn(`[SECURITY] Malicious privilege escalation attempt by agent ${userId}`);
      try { await admin.auth().deleteUser(userId); } catch (e) {}
      await db.collection('security_logs').add({
        type: 'PRIVILEGE_ESCALATION_ATTEMPT',
        userId: userId,
        email: after.email,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        description: 'Agent attempted to grant themselves admin privileges and was automatically terminated.',
        severity: 'CRITICAL'
      });
      await change.after.ref.delete();
    }
  });

exports.revokeFakeAdmins = functions.https.onRequest(async (req, res) => {
  try {
    const maliciousIds = [
      '0y26k7bgMcaU2iBdJNB3gx2zjkY2',
      'EibZxlae7kakk7zkyIy6Saxn48i2',
      'Lw4vNALe7EbO3DqPG9MTHa1Iviv1',
      'Ng7ml52rQZN0XoD7GM9z',
      'VVpgwUZmdtcTsqijVZt3oywzVaO2',
      'YHMZHh5mcJXvfGZdf6zMaBPaShl1',
      'fPCfy5UWL5YhYDLqPCQMSQHqj9O2',
      'jHuk8S4fNIezAyYCCTXAyjCXPTY2',
      'taO9ie42yVgdrQUfYtimw2H4izX2'
    ];
    
    let deleted = [];
    
    for (let id of maliciousIds) {
      try {
        await admin.auth().deleteUser(id);
      } catch(e) {
        // user might already be deleted from Auth
      }
      
      try {
        await db.collection('users').doc(id).delete();
      } catch(e) {}
      
      try {
        await db.collection('agents').doc(id).delete();
      } catch(e) {}
      
      deleted.push(id);
    }

    res.json({ success: true, deletedAccounts: deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Suspicious Payout Management ──
exports.approveSuspiciousPayout = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  
  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  const callerData = callerSnap.data() || {};
  const email = context.auth.token.email || '';
  const isSuperAdmin = ['zolamoneytrans@gmail.com', 'drnduwa@gmail.com', 'zolamoneytransmarchand@gmail.com'].includes(email);
  if (!isSuperAdmin && (!callerSnap.exists || (!callerData.admin && callerData.role !== 'admin' && !callerData.isAdmin))) {
    throw new functions.https.HttpsError('permission-denied', 'Accès refusé. Privilèges administrateur requis.');
  }

  const { txId } = data;
  if (!txId) throw new functions.https.HttpsError('invalid-argument', 'ID de transaction manquant.');

  const txRef = db.collection('transactions').doc(txId);
  const txSnap = await txRef.get();
  if (!txSnap.exists) throw new functions.https.HttpsError('not-found', 'Transaction introuvable.');

  const tx = txSnap.data();
  if (tx.statut !== 'pending_admin_approval' || !tx.isSuspiciousPayout) {
    throw new functions.https.HttpsError('failed-precondition', 'Cette transaction n\'est pas en attente d\'approbation de sécurité.');
  }

  const amountNum = parseFloat(tx.montant) || 0;
  const method = normMethod(tx.operateur || 'mpesa');
  const beneficiaryNumber = tx.beneficiaryNumber || '';
  const reference = tx.reference || '';
  const currency = tx.currency || 'USD';

  let fpResponse;
  try {
    if (method === 'visa' || method === 'moko') {
      const nameParts = (tx.beneficiaire || 'Beneficiary Zola').split(' ');
      const mokoPayload = {
        amount: amountNum,
        currency: currency,
        merchant_reference: reference,
        order_type: 'payout',
        action: 'credit',
        bill_to_forename: nameParts[0] || 'Beneficiary',
        bill_to_surname: nameParts.slice(1).join(' ') || 'Zola',
        bill_to_email: tx.userEmail || 'info@zolamoneytrans.com',
        bill_to_phone: beneficiaryNumber || '+243000000000',
        bill_to_address_line1: "Kinshasa",
        bill_to_address_city: "Kinshasa",
        bill_to_address_state: "Kin",
        bill_to_address_postal_code: "0000",
        bill_to_address_country: "CD",
        callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
      };
      fpResponse = await mokoCardRequest(mokoPayload);
    } else {
      fpResponse = await freshpayRequest({
        action: 'credit',
        amount: String(amountNum),
        currency: currency,
        customer_number: formatPhoneLocal(beneficiaryNumber),
        reference: reference,
        method: method,
        callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
      });
    }

    await txRef.update({
      transactionId: fpResponse.Transaction_id || fpResponse.data?.transaction_uuid || '',
      freshpayStatus: fpResponse.Status || fpResponse.status || 'SUBMITTED',
      statut: 'en_attente',
      approvedBy: context.auth.uid,
      approvedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      await sendEmailWithNodemailer({
        to: 'zolamoneytrans@gmail.com',
        subject: `✅ Transaction Suspecte Approuvée - ${amountNum} ${currency}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #10B981;">✅ Retrait Suspect Approuvé</h2>
            <p>Une transaction préalablement signalée comme suspecte a été approuvée par un administrateur (${email}).</p>
            <ul>
              <li><strong>ID Transaction:</strong> ${txId}</li>
              <li><strong>Référence:</strong> ${reference}</li>
              <li><strong>Montant:</strong> ${amountNum} ${currency}</li>
              <li><strong>Bénéficiaire:</strong> ${tx.beneficiaire || beneficiaryNumber}</li>
            </ul>
            <p>Le paiement a été soumis avec succès à l'opérateur.</p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('[approveSuspiciousPayout] Failed to send email:', emailErr);
    }

    return { success: true, message: 'Payout suspect approuvé et soumis avec succès.' };
  } catch (err) {
    console.error('[approveSuspiciousPayout] Error:', err);
    throw new functions.https.HttpsError('internal', `Erreur lors de l'exécution du Payout: ${err.message}`);
  }
});

exports.revokeSuspiciousPayout = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  
  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  const callerData = callerSnap.data() || {};
  const email = context.auth.token.email || '';
  const isSuperAdmin = ['zolamoneytrans@gmail.com', 'drnduwa@gmail.com', 'zolamoneytransmarchand@gmail.com'].includes(email);
  if (!isSuperAdmin && (!callerSnap.exists || (!callerData.admin && callerData.role !== 'admin' && !callerData.isAdmin))) {
    throw new functions.https.HttpsError('permission-denied', 'Accès refusé. Privilèges administrateur requis.');
  }

  const { txId, reason } = data;
  if (!txId) throw new functions.https.HttpsError('invalid-argument', 'ID de transaction manquant.');

  const txRef = db.collection('transactions').doc(txId);
  const txSnap = await txRef.get();
  if (!txSnap.exists) throw new functions.https.HttpsError('not-found', 'Transaction introuvable.');

  const tx = txSnap.data();
  if (tx.statut !== 'pending_admin_approval' || !tx.isSuspiciousPayout) {
    throw new functions.https.HttpsError('failed-precondition', 'Cette transaction n\'est pas en attente d\'approbation de sécurité.');
  }

  await txRef.update({
    statut: 'rejeté',
    revokeReason: reason || 'Transaction suspecte révoquée par un administrateur.',
    revokedBy: context.auth.uid,
    revokedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    await sendEmailWithNodemailer({
      to: 'zolamoneytrans@gmail.com',
      subject: `❌ Transaction Suspecte Rejetée - ${tx.montant} ${tx.currency}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #EF4444;">❌ Retrait Suspect Rejeté</h2>
          <p>Une transaction préalablement signalée comme suspecte a été définitivement rejetée par un administrateur (${email}).</p>
          <ul>
            <li><strong>ID Transaction:</strong> ${txId}</li>
            <li><strong>Référence:</strong> ${tx.reference || ''}</li>
            <li><strong>Montant:</strong> ${tx.montant} ${tx.currency}</li>
            <li><strong>Bénéficiaire:</strong> ${tx.beneficiaire || tx.beneficiaryNumber}</li>
            <li><strong>Motif du rejet:</strong> ${reason || 'Non spécifié'}</li>
          </ul>
          <p>Les fonds n'ont pas été transférés.</p>
        </div>
      `
    });
  } catch (emailErr) {
    console.error('[revokeSuspiciousPayout] Failed to send email:', emailErr);
  }

  return { success: true, message: 'Payout suspect révoqué avec succès.' };
});

// ── USER SECURITY: Global Login Alerts ──
exports.notifyUserLogin = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  
  const email = context.auth.token.email || 'Inconnu';
  const uid = context.auth.uid;
  const userAgent = data.userAgent || 'Appareil inconnu';
  const role = data.role || 'Utilisateur';
  
  const ip = context.rawRequest ? (context.rawRequest.headers['x-forwarded-for'] || context.rawRequest.connection?.remoteAddress) : 'IP Inconnue';
  
  let location = 'Localisation inconnue';
  if (ip && ip !== 'IP Inconnue' && !ip.includes('127.0.0.1')) {
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip.split(',')[0].trim()}`);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
          location = `${geoData.city}, ${geoData.country}`;
        }
      }
    } catch (e) {
      console.warn('Could not fetch IP location:', e.message);
    }
  }

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #10B981;">🚀 Nouvelle connexion Utilisateur</h2>
      <p>Un utilisateur s'est connecté à Zola Money Trans.</p>
      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>Email :</strong> ${email}</p>
        <p style="margin: 5px 0;"><strong>Type de compte :</strong> ${role}</p>
        <p style="margin: 5px 0;"><strong>Adresse IP :</strong> ${ip}</p>
        <p style="margin: 5px 0;"><strong>Localisation :</strong> ${location}</p>
        <p style="margin: 5px 0;"><strong>Appareil :</strong> ${userAgent}</p>
        <p style="margin: 5px 0;"><strong>Heure :</strong> ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })} (Heure de Kinshasa)</p>
      </div>
      <p style="font-size: 12px; color: #6b7280; margin-top: 30px; text-align: center;">Cet e-mail a été envoyé automatiquement par le système de sécurité Zola Money Trans.</p>
    </div>
  `;

  try {
    await sendEmailWithNodemailer({
      to: 'zolamoneytrans@gmail.com',
      subject: `[ALERTE] Connexion Utilisateur (${role}) - ${email}`,
      html: html
    });
  } catch (emailErr) {
    console.error('[notifyUserLogin] Failed to send alert email:', emailErr);
  }

  return { success: true };
});

// ── ADMIN SECURITY: Login Alerts & Revocation ──
exports.notifyAdminLogin = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
  
  const email = context.auth.token.email || 'Inconnu';
  const uid = context.auth.uid;
  const userAgent = data.userAgent || 'Appareil inconnu';
  
  // Get IP address
  const ip = context.rawRequest ? (context.rawRequest.headers['x-forwarded-for'] || context.rawRequest.connection?.remoteAddress) : 'IP Inconnue';
  
  // Optional: fetch location based on IP if valid
  let location = 'Localisation inconnue';
  if (ip && ip !== 'IP Inconnue' && !ip.includes('127.0.0.1')) {
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip.split(',')[0].trim()}`);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData.status === 'success') {
          location = `${geoData.city}, ${geoData.country}`;
        }
      }
    } catch (e) {
      console.warn('Could not fetch IP location:', e.message);
    }
  }

  const revokeUrl = `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/revokeAdminSession?uid=${uid}`;

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #3b82f6;">🔒 Nouvelle connexion Administrateur</h2>
      <p>Une connexion au tableau de bord d'administration a été détectée.</p>
      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>Email :</strong> ${email}</p>
        <p style="margin: 5px 0;"><strong>Adresse IP :</strong> ${ip}</p>
        <p style="margin: 5px 0;"><strong>Localisation :</strong> ${location}</p>
        <p style="margin: 5px 0;"><strong>Appareil :</strong> ${userAgent}</p>
        <p style="margin: 5px 0;"><strong>Heure :</strong> ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })} (Heure de Kinshasa)</p>
      </div>
      <p>Si vous ne reconnaissez pas cette connexion, il s'agit peut-être d'un intrus. Vous pouvez immédiatement révoquer l'accès de cette session en cliquant sur le bouton ci-dessous :</p>
      <div style="text-align: center; margin-top: 25px;">
        <a href="${revokeUrl}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔴 Terminer la session de l'intrus</a>
      </div>
      <p style="font-size: 12px; color: #6b7280; margin-top: 30px; text-align: center;">Cet e-mail a été envoyé automatiquement par le système de sécurité Zola Money Trans.</p>
    </div>
  `;

  try {
    await sendEmailWithNodemailer({
      to: 'zolamoneytrans@gmail.com',
      subject: `🚨 Sécurité Zola: Connexion Admin détectée (${email})`,
      html: html
    });
  } catch (emailErr) {
    console.error('[notifyAdminLogin] Failed to send alert email:', emailErr);
  }

  return { success: true };
});

exports.revokeAdminSession = functions.https.onRequest(async (req, res) => {
  const uid = req.query.uid;
  if (!uid) {
    return res.status(400).send("UID manquant.");
  }

  try {
    await admin.auth().revokeRefreshTokens(uid);
    res.status(200).send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #10B981;">✅ Session révoquée avec succès</h1>
        <p>L'utilisateur a été déconnecté et tous ses jetons d'accès ont été invalidés.</p>
        <p>Il devra se reconnecter avec ses identifiants et son code PIN pour accéder à nouveau au tableau de bord.</p>
      </div>
    `);
  } catch (error) {
    console.error("Error revoking tokens:", error);
    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #EF4444;">❌ Erreur</h1>
        <p>Une erreur est survenue lors de la révocation de la session : ${error.message}</p>
      </div>
    `);
  }
});
