const fetch = require('node-fetch');

const FRESHPAY_MERCHANT_ID  = 'jcX5EE4uxq*71XaTb';
const FRESHPAY_MERCHANT_CODE = 'm2C1A8PYqzoy8';
const FRESHPAY_MERCHANT_SECRET = 'jz39wIV4JXXi6Vm@tb';
const FRESHPAY_API_URL = 'https://paydrc.gofreshbakery.net/api/v5/';

async function testApi(merchantId, emailKey) {
  const body = {
    merchant_id: merchantId,
    merchant_secrete: FRESHPAY_MERCHANT_SECRET,
    firstname: 'Zola',
    lastname: 'MoneyTrans',
    [emailKey]: 'info@zolamoneytrans.com',
    action: 'debit',
    amount: '100',
    currency: 'CDF',
    customer_number: '0971069967',
    reference: 'test_' + Date.now(),
    method: 'airtel',
    callback_url: 'https://example.com/callback'
  };

  try {
    const res = await fetch(FRESHPAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    console.log(`Response for ${merchantId} (${emailKey}): ${res.status} - ${text}`);
  } catch (err) {
    console.error(`Error for ${merchantId} (${emailKey}): ${err.message}`);
  }
}

async function run() {
  console.log("Testing with Merchant ID (jcX5EE4uxq*71XaTb)...");
  await testApi(FRESHPAY_MERCHANT_ID, 'email');
  
  console.log("Testing with Merchant Code (m2C1A8PYqzoy8)...");
  await testApi(FRESHPAY_MERCHANT_CODE, 'email');
}

run();
