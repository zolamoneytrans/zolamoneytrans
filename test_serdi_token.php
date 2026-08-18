<?php
$curl = curl_init();
curl_setopt_array($curl, array(
  CURLOPT_URL => 'https://public-apis.services.serdipay.com/api/public-api/v1/merchant/get-token',
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_ENCODING => '',
  CURLOPT_MAXREDIRS => 10,
  CURLOPT_TIMEOUT => 0,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
  CURLOPT_CUSTOMREQUEST => 'POST',
  CURLOPT_POSTFIELDS => array('email' => 'emmanuelnduwa2019@gmail.com','password' => 'christanne1A'),
));
$response = curl_exec($curl);
$httpcode = curl_getinfo($curl, CURLINFO_HTTP_CODE);
curl_close($curl);
echo "HTTP Code: " . $httpcode . "\n";
echo "Response: " . $response . "\n";
?>
