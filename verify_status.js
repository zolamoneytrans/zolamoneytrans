

const FRESHPAY_MERCHANT_ID  = 'jcX5EE4uxq*71XaTb';
const FRESHPAY_MERCHANT_SECRET = 'jz39wIV4JXXi6Vm@tb';
const FRESHPAY_API_URL = 'https://paydrc.gofreshbakery.net/api/v5/';

async function verify() {
  const body = {
    merchant_id: FRESHPAY_MERCHANT_ID,
    merchant_secrete: FRESHPAY_MERCHANT_SECRET,
    action: 'verify',
    reference: 'ZOL-OUT-1779401696030-CM00'
  };
  
  const response = await fetch(FRESHPAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const data = await response.json();
  console.log(data);
}

verify();
