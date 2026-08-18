const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const files = ['pay.html', 'request_payment.html', 'scan.html', 'kyc.html'];

for (const file of files) {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Look for if (!user) { window.location.href = 'auth.html'; return; }
  // and insert the emailVerified check right after.
  
  if (content.includes('onAuthStateChanged(auth,')) {
    if (!content.includes('!user.emailVerified')) {
      const regex = /if\s*\(!user\)\s*\{\s*window\.location\.href\s*=\s*['"]auth\.html['"];\s*return;\s*\}/g;
      
      content = content.replace(regex, `if (!user) { window.location.href = 'auth.html'; return; }\n    if (!user.emailVerified && user.email !== "drnduwa@gmail.com") { window.location.href = 'auth.html?unverified=1'; return; }`);
      
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Patched ' + file);
    }
  }
}
