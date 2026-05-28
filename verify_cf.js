

async function testCloudFunction() {
  const payload = { data: { reference: 'ZOL-OUT-1779401696030-CM00' } };
  const res = await fetch('https://us-central1-zolamoneytransmarchand.cloudfunctions.net/checkStatus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log(await res.text());
}
testCloudFunction();
