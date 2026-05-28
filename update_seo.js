const fs = require('fs');
const path = require('path');

const seoBlock = `
  <!-- Primary Meta Tags -->
  <meta name="title" content="Zola Money Trans — Agrégateur de Paiement en RDC">
  <meta name="description" content="Zola Money Trans est le premier agrégateur de paiement marchand inter-opérateurs de la RDC. Acceptez M-Pesa, Airtel Money et Orange Money avec un seul QR code.">
  <meta name="keywords" content="Zola Money, Paiement RDC, Mobile Money RDC, M-Pesa, Airtel Money, Orange Money, Fintech Afrique, Transfert d'argent, Agrégateur de paiement, Zola">
  <meta name="author" content="Swazi Appli Lab SARL">

  <!-- Open Graph / Facebook / WhatsApp -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://zolamoneypay.com/">
  <meta property="og:title" content="Zola Money Trans — Paiement Mobile Unifié">
  <meta property="og:description" content="Acceptez tous les paiements Mobile Money (M-Pesa, Airtel, Orange) en RDC avec un seul compte.">
  <meta property="og:image" content="https://zolamoneypay.com/icons/og_image_zola.png">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="https://zolamoneypay.com/">
  <meta property="twitter:title" content="Zola Money Trans — Paiement Mobile Unifié">
  <meta property="twitter:description" content="Acceptez tous les paiements Mobile Money en RDC avec un seul compte.">
  <meta property="twitter:image" content="https://zolamoneypay.com/icons/og_image_zola.png">
`;

const files = ['index.html', 'auth.html', 'help.html', 'privacy.html', 'pay.html'];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Remove existing title and description if any
  content = content.replace(/<title>[\s\S]*?<\/title>/gi, '');
  content = content.replace(/<meta name="description"[\s\S]*?>/gi, '');
  content = content.replace(/<meta name="title"[\s\S]*?>/gi, '');
  
  // Insert seoBlock right after viewport
  content = content.replace(/(<meta name="viewport" content="width=device-width, initial-scale=1\.0"\/>)/i, '$1\n' + seoBlock + '\n');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated ' + file);
});
