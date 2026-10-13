<?php

declare(strict_types=1);

namespace SpacedTracker\Ui;

use Dotenv\Dotenv;

/**
 * Reads the package .env file without writing the process environment.
 *
 * Keys already set in the process, including empty ones, win. A missing file
 * leaves the process environment unchanged.
 */
final class Environment
{
    /**
     * @param array<string, string>|null $base
     * @return array<string, string>
     */
    public static function load(?string $root = null, ?array $base = null): array
    {
        $env = $base ?? self::process();
        $root ??= dirname(__DIR__);
        if (!is_file($root . DIRECTORY_SEPARATOR . '.env')) {
            return $env;
        }

        $loaded = Dotenv::createArrayBacked($root)->safeLoad();
        foreach ($loaded as $key => $value) {
            if (is_string($value) && !array_key_exists($key, $env)) {
                $env[$key] = $value;
            }
        }

        return $env;
    }

    /**
     * @return array<string, string>
     */
    private static function process(): array
    {
        $env = [];
        foreach (getenv() as $key => $value) {
            $env[(string) $key] = $value;
        }

        return $env;
    }
}
