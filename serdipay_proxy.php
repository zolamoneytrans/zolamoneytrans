<?php
// serdipay_proxy.php
// Ce script agit comme un proxy sécurisé pour permettre à Firebase d'appeler SerdiPay
// avec l'IP whitelistée du serveur (156.155.252.34).

// Sécurité basique : Accepter uniquement les requêtes POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

// Récupérer le payload envoyé par Firebase
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);

if (!$input || !isset($input['endpoint'])) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid payload, 'endpoint' is missing"]);
    exit;
}

// On récupère l'endpoint SerdiPay cible (ex: /get-token ou /payment-merchant)
$endpoint = $input['endpoint'];
$payload = isset($input['payload']) ? $input['payload'] : [];
$headers = isset($input['headers']) ? $input['headers'] : [];

// Construire l'URL SerdiPay
$serdipayUrl = 'https://public-apis.services.serdipay.com/api/public-api/v1/merchant' . $endpoint;

// Construire les headers pour curl
$curlHeaders = [];
foreach ($headers as $key => $value) {
    $curlHeaders[] = "$key: $value";
}
if (!in_array('Content-Type: application/json', $curlHeaders)) {
    $curlHeaders[] = 'Content-Type: application/json';
}

// Initialiser cURL
$ch = curl_init($serdipayUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, $curlHeaders);
// Ne pas vérifier le SSL si jamais le serveur a des vieux certificats (optionnel mais parfois utile en cPanel)
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

// Exécuter la requête
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// Renvoyer la réponse exacte à Firebase
http_response_code($httpCode ? $httpCode : 500);

if ($response === false) {
    echo json_encode(["error" => "cURL Error: " . $curlError]);
} else {
    // Si la réponse n'est pas du JSON, on la wrap
    $decoded = json_decode($response, true);
    if ($decoded === null) {
        echo json_encode(["raw_response" => $response]);
    } else {
        echo $response;
    }
}
?>
