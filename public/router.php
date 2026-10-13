<?php

declare(strict_types=1);

$autoload = dirname(__DIR__) . '/vendor/autoload.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) ? $path : '/';

if (is_file($autoload)) {
    require $autoload;
    if (SpacedTracker\Ui\FrontController::resolveInside(__DIR__, $path) !== null) {
        return false;
    }
}

require __DIR__ . '/index.php';
