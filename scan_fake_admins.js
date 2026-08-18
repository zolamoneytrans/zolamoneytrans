const admin = require('firebase-admin');

// Ensure firebase-admin is initialized. 
// Assuming this is run with FIREBASE_CONFIG or google application credentials
admin.initializeApp();

const db = admin.firestore();

async function scan() {
  const legitimateAdminEmails = ['zolamoneytrans@gmail.com', 'drnduwa@gmail.com', 'zolamoneytransmarchand@gmail.com'];
  let fakeAdmins = [];

  const usersSnap = await db.collection('users').where('admin', '==', true).get();
  usersSnap.forEach(doc => {
    const data = doc.data();
    if (!legitimateAdminEmails.includes(data.email)) {
      fakeAdmins.push({ id: doc.id, collection: 'users', email: data.email, role: data.role });
    }
  });

  const usersSnap2 = await db.collection('users').where('role', '==', 'admin').get();
  usersSnap2.forEach(doc => {
    const data = doc.data();
    if (!legitimateAdminEmails.includes(data.email)) {
      if (!fakeAdmins.find(x => x.id === doc.id)) {
        fakeAdmins.push({ id: doc.id, collection: 'users', email: data.email, role: data.role });
      }
    }
  });

  console.log(JSON.stringify(fakeAdmins, null, 2));
}

scan().catch(console.error);
