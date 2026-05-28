const https = require('https');
const fs = require('fs');

https.get('https://us-central1-zolamoneytransmarchand.cloudfunctions.net/dumpDb', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('dumpDb.json', data);
    console.log('Done!');
  });
}).on('error', err => console.error(err));
