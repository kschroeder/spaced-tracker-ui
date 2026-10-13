<?php

declare(strict_types=1);

$autoload = dirname(__DIR__) . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Composer autoload was not found.\n";
    return;
}
require $autoload;

try {
    $env = SpacedTracker\Ui\Environment::load(dirname(__DIR__));
} catch (Dotenv\Exception\ExceptionInterface $exception) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo $exception->getMessage() . "\n";
    return;
}

SpacedTracker\Ui\FrontController::fromEnvironment($env)->run();
