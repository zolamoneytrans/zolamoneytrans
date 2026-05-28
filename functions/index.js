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

// ── Helper: Vérification KYC ──
async function verifyKYC(uid, amountCDF) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'Utilisateur introuvable.');
  const user = userDoc.data();
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
  const user = await verifyKYC(uid, currency === 'USD' ? amountNum * 2900 : amountNum);

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

  const user = await verifyKYC(uid, currency === 'USD' ? amountNum * 2900 : amountNum);
  await checkAML(uid, currency === 'USD' ? amountNum * 2900 : amountNum, currency, 'transfert', reference);

  const fpResponse = await freshpayRequest({
    action: 'credit',
    amount: String(amountNum),
    currency: currency,
    customer_number: formatPhoneLocal(beneficiaryNumber),
    reference: reference,
    method: normMethod(method),
    callback_url: `https://us-central1-zolamoneytransmarchand.cloudfunctions.net/freshpayCallback`
  });

  const txRef = await db.collection('transactions').add({
    userId: uid,
    userEmail: user.email || '',
    type: 'Transfert',
    action: 'credit',
    montant: amountNum,
    currency,
    operateur: method,
    operateurSource: srcMethod || '',
    beneficiaire: beneficiaryName || beneficiaryNumber,
    beneficiaryNumber,
    reference,
    transactionId: fpResponse.Transaction_id || '',
    freshpayStatus: fpResponse.Status || '',
    statut: 'en_attente',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    success: true,
    transactionId: fpResponse.Transaction_id || '',
    freshpayRef: reference,
    firestoreId: txRef.id,
    message: fpResponse.Comment || 'Transfert soumis'
  };
});

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

  // Mise à jour Firestore si on a l'ID du doc
  if (firestoreId) {
    await db.collection('transactions').doc(firestoreId).update({
      statut,
      transStatus: fpResponse.Trans_Status || '',
      financialInstitutionId: fpResponse.Financial_Institution_id || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return { statut, transStatus, details: fpResponse };
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

          // Si c'est un transfert inter-opérateur (Débit réussi), on lance le Crédit (PayOut)
          if (tx.isTransfer && !tx.payOutInitiated) {
            await snap.docs[0].ref.update({ payOutInitiated: true });
            
            const outRef = 'ZOL-OUT-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
            try {
              console.log(`[Webhook] Déclenchement automatique du PayOut (Crédit) pour la ref ${reference}`);
              
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
                parentReference: reference,
                statut: 'en_attente',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
            } catch (errOut) {
              console.error('[Webhook] Erreur lors du déclenchement du payOut:', errOut);
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
                parentReference: reference,
                statut: 'échoué',
                transStatusDescription: errOut.message || 'Erreur FreshPay Payout',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
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
    'airtel': 'airtel', 'Airtel Money': 'airtel', 'airtel money': 'airtel',
    'orange': 'orange', 'Orange Money': 'orange', 'orange money': 'orange',
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
exports.getMerchantInfo = functions.runWith(vpcOptions).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const { merchantUid } = data;
  if (!merchantUid) {
    throw new functions.https.HttpsError('invalid-argument', 'UID du marchand manquant.');
  }

  const merchSnap = await db.collection('users').doc(merchantUid).get();
  if (!merchSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Marchand introuvable.');
  }

  const merchData = merchSnap.data();

  // Ne renvoyer que les informations publiques nécessaires
  return {
    name: merchData.name || merchData.displayName || 'Utilisateur',
    photoURL: merchData.photoURL || null,
    kycLevel: merchData.kycLevel || 'basique',
    autoSettlementEnabled: merchData.autoSettlementEnabled || false,
    autoSettlementMethod: merchData.autoSettlementMethod || null,
    autoSettlementTarget: merchData.autoSettlementTarget || null
  };
});

exports.dumpDb = functions.runWith(vpcOptions).https.onRequest(async (req, res) => {
  const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(20).get();
  res.json(snap.docs.map(d => ({id: d.id, ...d.data()})));
});

// ═══════════════════════════════════════════════════════════
// AUTH TRIGGER — Notify Admin on Registration
// ═══════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

exports.notifyAdminOnRegistration = functions.auth.user().onCreate(async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_EMAIL || 'drnduwa@gmail.com',
        pass: process.env.GMAIL_PASSWORD || 'hpgzykxoklxnevpi'
      }
    });

    const mailOptions = {
      from: '"Zola Money Trans" <no-reply@zolamoneytrans.com>',
      to: 'drnduwa@gmail.com',
      subject: 'Nouvel utilisateur inscrit sur Zola Money Trans !',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
          <h2 style="color: #7C3AED;">Nouveau client inscrit</h2>
          <p>Un nouvel utilisateur vient de créer un compte sur la plateforme Zola Money Trans.</p>
          <ul>
            <li><strong>ID Utilisateur :</strong> ${user.uid}</li>
            <li><strong>Email :</strong> ${user.email || 'Non renseigné'}</li>
            <li><strong>Nom :</strong> ${user.displayName || 'Non renseigné'}</li>
            <li><strong>Téléphone :</strong> ${user.phoneNumber || 'Non renseigné'}</li>
            <li><strong>Date :</strong> ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}</li>
          </ul>
          <p>Rendez-vous dans votre <a href="https://zolamoneytransmarchand.web.app/admin.html" style="color: #7C3AED;">Tableau de bord Admin</a> pour gérer cet utilisateur.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email] Notification admin envoyée pour le nouvel utilisateur: ${user.uid}`);
  } catch (error) {
    console.error('[Email Error] Échec de l\'envoi de la notification admin:', error);
  }
});

