const fetch = require('node-fetch');

async function test() {
  const res = await fetch('https://www.zolamoneytrans.com/serdipay_proxy.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      endpoint: '/get-token',
      payload: { email: 'emmanuelnduwa2019@gmail.com', password: 'christanne1A' } 
    })
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
  
  if (res.ok) {
    const data = JSON.parse(text);
    const token = data.access_token;
    
    // Now try payIn
    const payload = {
      api_id: "APIE2DWB9A",
      api_password: "christanne1A",
      merchantCode: "141507",
      merchant_pin: "1234",
      clientPhone: "0812345678",
      amount: 10,
      currency: "USD",
      telecom: "MP"
    };
    const res2 = await fetch('https://www.zolamoneytrans.com/serdipay_proxy.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: '/payment-merchant',
        headers: { 'Authorization': `Bearer ${token}` },
        payload: payload
      })
    });
    const text2 = await res2.text();
    console.log('PayIn Status:', res2.status);
    console.log('PayIn Response:', text2);
  }
}

test();
