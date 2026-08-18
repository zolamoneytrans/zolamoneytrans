import { 
  auth, db, storage, 
  createUserWithEmailAndPassword, 
  setDoc, doc, serverTimestamp,
  sendEmailVerification, signOut 
} from './firebase.js';
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Wizard Logic
let currentStep = 1;
const totalSteps = 4;

window.nextStep = function(step) {
  // Simple validation
  const currentContent = document.getElementById(`step-${step}`);
  const inputs = currentContent.querySelectorAll('input[required], select[required], textarea[required]');
  let valid = true;
  inputs.forEach(input => {
    if (!input.checkValidity()) {
      input.reportValidity();
      valid = false;
    }
  });

  if (step === 1) {
    const pwd = document.getElementById('agentPassword').value;
    const confirm = document.getElementById('agentConfirmPassword').value;
    if (pwd !== confirm) {
      alert("Les mots de passe ne correspondent pas.");
      return;
    }
    if (pwd.length < 8) {
      alert("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
  }

  if (step === 3) {
    const op = document.getElementById('agentSelectedOperator').value;
    if (!op) {
      alert("Veuillez sélectionner un opérateur.");
      return;
    }
  }

  if (valid && step < totalSteps) {
    document.getElementById(`step-${step}`).classList.remove('active');
    document.getElementById(`step-${step + 1}`).classList.add('active');
    
    document.getElementById(`step-ind-${step}`).classList.remove('active');
    document.getElementById(`step-ind-${step}`).classList.add('completed');
    document.getElementById(`step-ind-${step + 1}`).classList.add('active');
    currentStep++;
  }
};

window.prevStep = function(step) {
  if (step > 1) {
    document.getElementById(`step-${step}`).classList.remove('active');
    document.getElementById(`step-${step - 1}`).classList.add('active');
    
    document.getElementById(`step-ind-${step}`).classList.remove('active');
    document.getElementById(`step-ind-${step - 1}`).classList.remove('completed');
    document.getElementById(`step-ind-${step - 1}`).classList.add('active');
    currentStep--;
  }
};

window.selectOperator = function(opId) {
  document.querySelectorAll('.operator-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.operator-card[data-op="${opId}"]`).classList.add('selected');
  document.getElementById('agentSelectedOperator').value = opId;
  document.getElementById('mmPhoneGroup').style.display = 'block';
};

window.checkPasswordStrength = function() {
  const pwd = document.getElementById('agentPassword').value;
  const bar = document.getElementById('pwdStrengthBar');
  let strength = 0;
  if (pwd.length >= 8) strength += 33;
  if (pwd.match(/[A-Z]/)) strength += 33;
  if (pwd.match(/[0-9]/)) strength += 34;
  
  bar.style.width = strength + '%';
  if (strength < 40) bar.style.backgroundColor = 'red';
  else if (strength < 80) bar.style.backgroundColor = 'orange';
  else bar.style.backgroundColor = 'green';
};

// File Upload Preview
window.handleFileUpload = function(input, previewId) {
  const previewContainer = document.getElementById(previewId);
  previewContainer.innerHTML = '';
  if (input.files) {
    Array.from(input.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const div = document.createElement('div');
        div.className = 'file-preview';
        div.innerHTML = `<img src="${e.target.result}" /> <span style="font-size:0.8rem">${file.name}</span>`;
        previewContainer.appendChild(div);
      }
      reader.readAsDataURL(file);
    });
  }
};

// Form Submission
document.getElementById('agentWizardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = document.getElementById('submitBtn');
  const spinner = document.getElementById('submitSpinner');
  const btnText = document.getElementById('submitBtnText');
  
  submitBtn.disabled = true;
  spinner.style.display = 'inline-block';
  btnText.style.display = 'none';

  try {
    const email = document.getElementById('agentEmail').value.trim();
    const password = document.getElementById('agentPassword').value;

    // 1. Create Auth User
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // 2. Upload Files
    const uploadFile = async (fileInputId, path) => {
      const file = document.getElementById(fileInputId).files[0];
      if (!file) return null;
      const fRef = storageRef(storage, `agents/${uid}/documents/${path}_${file.name}`);
      await uploadBytes(fRef, file);
      return await getDownloadURL(fRef);
    };

    const idUploadUrl = await uploadFile('agentIdUpload', 'id');
    const selfieUrl = await uploadFile('agentSelfie', 'selfie');
    const shopUrl = await uploadFile('agentShopPhoto', 'shop');

    // 3. Create Firestore Document
    const agentData = {
      uid: uid,
      agentCode: null,
      status: "pending",
      tier: "debutant",
      
      firstName: document.getElementById('agentFirstName').value.trim(),
      lastName: document.getElementById('agentLastName').value.trim(),
      email: email,
      phone: "+243" + document.getElementById('agentPhone').value.trim().replace(/^0+/, ''),
      whatsapp: document.getElementById('agentWhatsapp').value.trim() ? "+243" + document.getElementById('agentWhatsapp').value.trim().replace(/^0+/, '') : "",
      idType: document.getElementById('agentIdType').value,
      idNumber: document.getElementById('agentIdNumber').value.trim(),
      
      businessName: document.getElementById('agentBusinessName').value.trim(),
      businessType: document.getElementById('agentBusinessType').value,
      province: document.getElementById('agentProvince').value,
      commune: document.getElementById('agentCommune').value.trim(),
      quartier: document.getElementById('agentQuartier').value.trim(),
      address: document.getElementById('agentAddress').value.trim(),
      openingHours: document.getElementById('agentHours').value.trim(),
      
      selectedOperator: document.getElementById('agentSelectedOperator').value,
      mmPhone: "+243" + document.getElementById('agentMmPhone').value.trim().replace(/^0+/, ''),
      
      documents: {
        idDoc: idUploadUrl,
        selfie: selfieUrl,
        businessPhoto: shopUrl,
      },
      
      commissions: {
        total: 0,
        pending: 0,
        released: 0,
      },
      
      createdAt: serverTimestamp(),
      role: 'agent' // specific role for agent
    };

    await setDoc(doc(db, 'agents', uid), agentData);
    // Also create a basic user record to prevent dashboard routing issues, or adjust firebase.js routing
    await setDoc(doc(db, 'users', uid), {
      prenom: agentData.firstName,
      nom: agentData.lastName,
      email: email,
      type: 'agent',
      role: 'agent',
      createdAt: serverTimestamp()
    });

    await sendEmailVerification(cred.user);
    await signOut(auth);

    // 4. Show Success
    document.getElementById('step-4').classList.remove('active');
    document.querySelector('.progress-bar').style.display = 'none';
    document.getElementById('step-success').classList.add('active');
    
    const timestamp = new Date().getTime().toString().slice(-6);
    document.getElementById('successRef').innerText = `ZMT-AG-P${timestamp}`;

  } catch (error) {
    console.error("Error creating agent: ", error);
    const alertEl = document.getElementById('authAlert');
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-danger';
    alertEl.innerText = error.message;
  } finally {
    submitBtn.disabled = false;
    spinner.style.display = 'none';
    btnText.style.display = 'inline';
  }
});
