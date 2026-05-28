import urllib.request, urllib.error, json
data = json.dumps({'merchant_id':'jcX5EE4uxq*71XaTb','merchant_secrete':'jz39wIV4JXXi6Vm@tb','amount':'100','currency':'CDF','action':'debit','customer_number':'0971069967','firstname':'Emmanuel','lastname':'Ndawa','email':'drnduwa@gmail.com','reference':'testfp092','method':'airtel','callback_url':''}).encode('utf-8')
req = urllib.request.Request('https://paydrc.gofreshbakery.net/api/v5/', data=data, headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
try:
    res=urllib.request.urlopen(req)
    print('OK:', res.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('Err:', e.code, e.read().decode('utf-8'))
