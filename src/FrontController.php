<?php

declare(strict_types=1);

namespace SpacedTracker\Ui;

use SpacedTracker\Api\Demo\DemoClient;
use SpacedTracker\Api\Http\ApiConfig;
use SpacedTracker\Api\Http\Application;
use SpacedTracker\Cache\FileCache;
use SpacedTracker\ClientBuilder;
use SpacedTracker\SpaceTrackClientInterface;
use Nyholm\Psr7\Factory\Psr17Factory;
use Psr\Clock\ClockInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Serves the catalog API under /api and the built Vue app everywhere else.
 *
 * The browser talks only to this origin. Space-Track cookies and model API
 * keys stay in the PHP process. Live mode configures the Space-Track client
 * with a file cache whose default TTL is 60 seconds.
 */
final class FrontController
{
    private readonly Application $api;

    public function __construct(
        Application $api,
        private readonly string $publicDir,
    ) {
        // This front controller only forwards /api. Mount the catalog there
        // even when the caller built an unprefixed application.
        $this->api = $api->prefix() === '/api' ? $api : $api->withPrefix('/api');
    }

    /**
     * Build the console from the environment.
     *
     * `$http` and `$clock` override the client the builder would create. Live
     * mode still needs a PSR-18 client when neither Symfony nor Guzzle is installed.
     *
     * @param array<string, string>|null $env
     */
    public static function fromEnvironment(
        ?array $env = null,
        ?ClientInterface $http = null,
        ?ClockInterface $clock = null,
    ): self {
        $config = ApiConfig::fromEnvironment($env);

        return new self(
            new Application(self::client($env, $config, $http, $clock), $config),
            dirname(__DIR__) . '/public',
        );
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $path = $request->getUri()->getPath();
        if ($path === '') {
            $path = '/';
        }
        if ($path === '/api' || str_starts_with($path, '/api/')) {
            return $this->api->handle($request);
        }
        if ($path !== '/' && str_starts_with($path, '/app/')) {
            $file = $this->resolvePublicFile($path);
            if ($file === null) {
                return $this->text(404, 'Not found.');
            }

            return $this->file($file);
        }

        $index = $this->resolvePublicFile('/app/index.html');
        if ($index === null) {
            return $this->text(
                503,
                'The catalog UI has not been built. From spaced-tracker-ui/frontend run npm install and npm run build.',
            );
        }

        return $this->file($index);
    }

    public function run(?ServerRequestInterface $request = null): void
    {
        $response = $this->handle($request ?? Application::captureRequest());
        if (!headers_sent()) {
            http_response_code($response->getStatusCode());
            foreach ($response->getHeaders() as $name => $values) {
                $replace = true;
                foreach ($values as $value) {
                    header($name . ': ' . $value, $replace);
                    $replace = false;
                }
            }
        }
        echo (string) $response->getBody();
    }

    /**
     * Resolve a URL path to a file inside the public directory.
     *
     * Returns null for directories, missing files, NUL bytes, and any path
     * that escapes the public directory after realpath().
     */
    public static function resolveInside(string $publicDir, string $urlPath): ?string
    {
        $urlPath = rawurldecode($urlPath);
        if ($urlPath === '' || $urlPath === '/' || str_contains($urlPath, "\0")) {
            return null;
        }
        if (preg_match('#(^|/)\.\.(/|$)#', $urlPath) === 1) {
            return null;
        }
        $public = realpath($publicDir);
        if ($public === false) {
            return null;
        }
        $candidate = $public . '/' . ltrim($urlPath, '/');
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            return null;
        }
        $prefix = $public . DIRECTORY_SEPARATOR;
        if (!str_starts_with($resolved, $prefix)) {
            return null;
        }

        return $resolved;
    }

    private function resolvePublicFile(string $urlPath): ?string
    {
        return self::resolveInside($this->publicDir, $urlPath);
    }

    private function file(string $path): ResponseInterface
    {
        $factory = new Psr17Factory();

        return $factory->createResponse(200)
            ->withHeader('Content-Type', $this->mime($path))
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withBody($factory->createStreamFromFile($path));
    }

    private function text(int $status, string $message): ResponseInterface
    {
        $factory = new Psr17Factory();

        return $factory->createResponse($status)
            ->withHeader('Content-Type', 'text/plain; charset=utf-8')
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withBody($factory->createStream($message));
    }

    private function mime(string $path): string
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'html' => 'text/html; charset=utf-8',
            'js', 'mjs' => 'text/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8',
            'json' => 'application/json',
            'svg' => 'image/svg+xml',
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            default => 'application/octet-stream',
        };
    }

    /**
     * @param array<string, string>|null $env
     */
    private static function client(
        ?array $env,
        ApiConfig $config,
        ?ClientInterface $http,
        ?ClockInterface $clock,
    ): SpaceTrackClientInterface {
        if ($config->mode === 'demo') {
            return new DemoClient();
        }

        $directory = self::cacheDirectory($env);
        $ttl = self::cacheTtl($env);
        $cache = $clock instanceof ClockInterface
            ? new FileCache($directory, $ttl, $clock)
            : new FileCache($directory, $ttl);
        $builder = ClientBuilder::fromEnvironment($env)->withCache($cache);
        if ($http instanceof ClientInterface) {
            $builder = $builder->withHttpClient($http);
        }
        if ($clock instanceof ClockInterface) {
            $builder = $builder->withClock($clock);
        }

        return $builder->build();
    }

    /**
     * @param array<string, string>|null $env
     */
    private static function cacheDirectory(?array $env): string
    {
        $configured = trim((string) (self::envValue('SPACED_TRACKER_CACHE_DIR', $env) ?? ''));
        if ($configured === '' || str_contains($configured, "\0")) {
            if ($configured !== '') {
                throw new \InvalidArgumentException('SPACED_TRACKER_CACHE_DIR is not a usable path.');
            }

            return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kschroeder-spaced-tracker-ui';
        }

        return $configured;
    }

    /**
     * @param array<string, string>|null $env
     */
    private static function cacheTtl(?array $env): int
    {
        $raw = trim((string) (self::envValue('SPACED_TRACKER_CACHE_TTL', $env) ?? ''));
        if ($raw === '') {
            return FileCache::DEFAULT_TTL_SECONDS;
        }
        if (preg_match('/^[1-9]\d*$/', $raw) !== 1) {
            throw new \InvalidArgumentException('SPACED_TRACKER_CACHE_TTL must be a positive number of seconds.');
        }

        return (int) $raw;
    }

    /**
     * @param array<string, string>|null $env
     */
    private static function envValue(string $key, ?array $env): ?string
    {
        if ($env !== null) {
            return $env[$key] ?? null;
        }

        $value = getenv($key);

        return $value === false ? null : $value;
    }
}
