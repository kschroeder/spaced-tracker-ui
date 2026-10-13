<?php

declare(strict_types=1);

namespace SpacedTracker\Ui\Tests;

use SpacedTracker\Api\Http\Application;
use SpacedTracker\Testing\FrozenClock;
use SpacedTracker\Testing\MockHttpClient;
use SpacedTracker\Ui\FrontController;
use Nyholm\Psr7\Factory\Psr17Factory;
use PHPUnit\Framework\TestCase;

final class FrontControllerTest extends TestCase
{
    private string $publicDir;

    /** @var list<string> */
    private array $cacheDirs = [];

    protected function setUp(): void
    {
        $this->publicDir = sys_get_temp_dir() . '/spaced-ui-' . bin2hex(random_bytes(4));
        mkdir($this->publicDir . '/app/assets', 0777, true);
        file_put_contents($this->publicDir . '/app/index.html', '<!doctype html><title>Spaced Tracker</title><h1>SPACED TRACKER</h1>');
        file_put_contents($this->publicDir . '/app/assets/app.js', 'console.log("catalog")');
    }

    protected function tearDown(): void
    {
        $secret = dirname($this->publicDir) . '/secret.txt';
        if (is_file($secret)) {
            unlink($secret);
        }
        $this->remove($this->publicDir);
        foreach ($this->cacheDirs as $directory) {
            $this->remove($directory);
        }
    }

    public function testApiAndSpaStayOnTheSameOrigin(): void
    {
        $front = $this->front();
        $healthResponse = $front->handle($this->request('GET', '/api/health'));
        $health = $this->json($healthResponse);
        $home = $front->handle($this->request('GET', '/'));
        $script = $front->handle($this->request('GET', '/app/assets/app.js'));
        $route = $front->handle($this->request('GET', '/catalog'));

        self::assertSame('demo', $health['mode']);
        self::assertSame('', $healthResponse->getHeaderLine('Cache-Control'));
        self::assertSame('', $home->getHeaderLine('Cache-Control'));
        self::assertStringContainsString('SPACED TRACKER', (string) $home->getBody());
        self::assertStringContainsString('javascript', $script->getHeaderLine('Content-Type'));
        self::assertSame('', $script->getHeaderLine('Cache-Control'));
        self::assertStringContainsString('catalog', (string) $script->getBody());
        self::assertSame('', $route->getHeaderLine('Cache-Control'));
        self::assertStringContainsString('SPACED TRACKER', (string) $route->getBody());
    }

    public function testAssetPathsCannotLeaveThePublicDirectory(): void
    {
        file_put_contents(dirname($this->publicDir) . '/secret.txt', 'secret-token');
        $response = $this->front()->handle($this->request('GET', '/app/../../secret.txt'));

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('', $response->getHeaderLine('Cache-Control'));
        self::assertStringNotContainsString('secret-token', (string) $response->getBody());
    }

    public function testMissingBuildExplainsHowToBuild(): void
    {
        unlink($this->publicDir . '/app/index.html');
        $response = $this->front()->handle($this->request('GET', '/'));

        self::assertSame(503, $response->getStatusCode());
        self::assertSame('', $response->getHeaderLine('Cache-Control'));
        self::assertStringContainsString('npm run build', (string) $response->getBody());
    }

    public function testStaticFilesUseTheirMediaTypes(): void
    {
        $files = [
            'app.css' => ['text/css', 'body{}'],
            'app.json' => ['application/json', '{}'],
            'mark.svg' => ['image/svg+xml', '<svg/>'],
            'mark.png' => ['image/png', 'png'],
            'mark.jpg' => ['image/jpeg', 'jpg'],
            'mark.jpeg' => ['image/jpeg', 'jpeg'],
            'font.woff' => ['font/woff', 'woff'],
            'font.woff2' => ['font/woff2', 'woff2'],
            'module.mjs' => ['text/javascript', 'export 1'],
            'data.bin' => ['application/octet-stream', 'bin'],
        ];
        foreach ($files as $name => [$type, $contents]) {
            file_put_contents($this->publicDir . '/app/assets/' . $name, $contents);
            $response = $this->front()->handle($this->request('GET', '/app/assets/' . $name));

            self::assertSame(200, $response->getStatusCode(), $name);
            self::assertStringContainsString($type, $response->getHeaderLine('Content-Type'), $name);
            self::assertSame('nosniff', $response->getHeaderLine('X-Content-Type-Options'), $name);
            self::assertSame('', $response->getHeaderLine('Cache-Control'), $name);
            self::assertSame($contents, (string) $response->getBody(), $name);
        }
    }

    public function testResolveInsideRejectsPathsThatAreNotFilesInThePublicDirectory(): void
    {
        $secret = dirname($this->publicDir) . '/secret.txt';
        file_put_contents($secret, 'secret-token');
        symlink($secret, $this->publicDir . '/app/assets/linked.txt');
        $empty = $this->front()->handle($this->request('GET', '/')->withUri(
            (new Psr17Factory())->createUri('http://127.0.0.1/')->withPath(''),
        ));
        $directory = $this->front()->handle($this->request('GET', '/app/'));
        $clientRoute = $this->front()->handle($this->request('GET', '/app'));

        self::assertNull(FrontController::resolveInside($this->publicDir, ''));
        self::assertNull(FrontController::resolveInside($this->publicDir, '/'));
        self::assertNull(FrontController::resolveInside($this->publicDir, "/app/assets/app.js\0.png"));
        self::assertNull(FrontController::resolveInside($this->publicDir, '/app/../../secret.txt'));
        self::assertNull(FrontController::resolveInside($this->publicDir, '/%2e%2e/secret.txt'));
        self::assertNull(FrontController::resolveInside($this->publicDir, '/app/assets'));
        self::assertNull(FrontController::resolveInside($this->publicDir . '/missing', '/app/index.html'));
        self::assertNull(FrontController::resolveInside($this->publicDir, '/app/assets/linked.txt'));
        $index = FrontController::resolveInside($this->publicDir, '/app/index.html');
        self::assertIsString($index);
        self::assertStringEndsWith('index.html', $index);
        self::assertStringContainsString('SPACED TRACKER', (string) $empty->getBody());
        self::assertSame(404, $directory->getStatusCode());
        self::assertStringContainsString('SPACED TRACKER', (string) $clientRoute->getBody());
    }

    public function testFromEnvironmentMountsTheApiOnThePackagePublicDirectory(): void
    {
        $front = FrontController::fromEnvironment(['SPACETRACK_IDENTITY' => '']);
        $health = $this->json($front->handle($this->request('GET', '/api/health')));

        self::assertSame('demo', $health['mode']);
    }

    public function testRunSetsTheStatusCodeBeforeWritingTheBody(): void
    {
        $status = 0;
        $body = $this->capture(function () use (&$status): void {
            $this->front()->run($this->request('GET', '/'));
            $status = http_response_code();
        });

        self::assertSame(200, $status);
        self::assertStringContainsString('SPACED TRACKER', $body);
    }

    public function testRunEmitsHeadersThroughTheBuiltInServer(): void
    {
        $router = sys_get_temp_dir() . '/spaced-ui-' . bin2hex(random_bytes(4)) . '.php';
        $autoload = var_export(dirname(__DIR__) . '/vendor/autoload.php', true);
        $public = var_export($this->publicDir, true);
        file_put_contents($router, <<<PHP
<?php
declare(strict_types=1);
require {$autoload};
\$front = new SpacedTracker\\Ui\\FrontController(
    SpacedTracker\\Api\\Http\\Application::fromEnvironment(['SPACETRACK_IDENTITY' => '']),
    {$public},
);
if ((\$_GET['premature'] ?? '') === '1') {
    echo 'already-sent';
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}
\$front->run();
PHP);
        try {
            $this->withServer($router, function (int $port): void {
                $home = $this->curl($port, '/');
                self::assertSame(200, $home['status']);
                self::assertStringContainsString('text/html', strtolower($home['headers']));
                self::assertStringContainsString('nosniff', strtolower($home['headers']));
                self::assertStringNotContainsString('cache-control:', strtolower($home['headers']));
                self::assertStringContainsString('SPACED TRACKER', $home['body']);

                $health = $this->curl($port, '/api/health');
                self::assertSame(200, $health['status']);
                self::assertStringContainsString('application/json', strtolower($health['headers']));
                self::assertSame('demo', json_decode($health['body'], true, 512, JSON_THROW_ON_ERROR)['mode']);

                $asset = $this->curl($port, '/app/assets/app.js');
                self::assertSame(200, $asset['status']);
                self::assertStringNotContainsString('cache-control:', strtolower($asset['headers']));
                self::assertSame('console.log("catalog")', $asset['body']);

                $missing = $this->curl($port, '/app/assets/missing.bin');
                self::assertSame(404, $missing['status']);
                self::assertStringContainsString('text/plain', strtolower($missing['headers']));
                self::assertSame('Not found.', $missing['body']);

                $early = $this->curl($port, '/app/assets/missing.bin?premature=1');
                self::assertSame(200, $early['status']);
                self::assertStringStartsWith('already-sent', $early['body']);
                self::assertStringContainsString('Not found.', $early['body']);
                self::assertStringNotContainsString('nosniff', strtolower($early['headers']));
            });
        } finally {
            if (is_file($router)) {
                unlink($router);
            }
        }
    }

    public function testLiveModeConfiguresTheCoreFileCacheForSixtySeconds(): void
    {
        $stack = $this->live([], [
            $this->loginResponse(),
            $this->jsonResponse('[{"NORAD_CAT_ID":25544,"OBJECT_NAME":"ISS"}]'),
            $this->jsonResponse('[{"NORAD_CAT_ID":25544,"OBJECT_NAME":"ISS (ZARYA)"}]'),
        ]);
        $query = fn (): \Psr\Http\Message\ServerRequestInterface => $this->request('POST', '/api/query', $this->catalogQuery());

        $first = $this->json($stack['front']->handle($query()));
        $stored = $this->cacheEntries($stack['dir']);
        $second = $this->json($stack['front']->handle($query()));

        self::assertSame('ISS', $first['records'][0]['OBJECT_NAME'] ?? null);
        self::assertSame(0, $second['duration_seconds']);
        self::assertSame('ISS', $second['records'][0]['OBJECT_NAME'] ?? null);
        self::assertCount(2, $stack['http']->requests);
        self::assertCount(2, $stored['expires']);
        $now = $stack['clock']->now()->getTimestamp();
        $remaining = array_map(static fn (int $expires): int => $expires - $now, $stored['expires']);
        sort($remaining);
        self::assertSame(60, $remaining[0]);
        self::assertGreaterThan(60, $remaining[1]);
        self::assertStringContainsString('chocolatechip', $stored['text']);
        self::assertStringNotContainsString('correct-horse-battery', $stored['text']);

        $stack['clock']->advance(59);
        $stack['front']->handle($query());
        self::assertCount(2, $stack['http']->requests);

        $stack['clock']->advance(2);
        $third = $this->json($stack['front']->handle($query()));
        $last = $stack['http']->requests[array_key_last($stack['http']->requests)];

        self::assertSame('ISS (ZARYA)', $third['records'][0]['OBJECT_NAME'] ?? null);
        self::assertCount(3, $stack['http']->requests);
        self::assertStringNotContainsString('ajaxauth/login', (string) $last->getUri());
    }

    public function testCacheTtlOverrideIsPassedToTheCoreCache(): void
    {
        $stack = $this->live(['SPACED_TRACKER_CACHE_TTL' => '10'], [
            $this->loginResponse(),
            $this->jsonResponse('[{"NORAD_CAT_ID":25544,"OBJECT_NAME":"ISS"}]'),
            $this->jsonResponse('[{"NORAD_CAT_ID":25544,"OBJECT_NAME":"ISS (ZARYA)"}]'),
        ]);
        $query = fn (): \Psr\Http\Message\ServerRequestInterface => $this->request('POST', '/api/query', $this->catalogQuery());

        $stack['front']->handle($query());
        $stack['front']->handle($query());
        self::assertCount(2, $stack['http']->requests);

        $stack['clock']->advance(9);
        $stack['front']->handle($query());
        self::assertCount(2, $stack['http']->requests);

        $stack['clock']->advance(2);
        $third = $this->json($stack['front']->handle($query()));

        self::assertSame('ISS (ZARYA)', $third['records'][0]['OBJECT_NAME'] ?? null);
        self::assertCount(3, $stack['http']->requests);
    }

    public function testDemoModeDoesNotCreateTheFileCache(): void
    {
        $directory = $this->cacheDir();
        $front = FrontController::fromEnvironment([
            'SPACETRACK_IDENTITY' => 'ada@example.com',
            'SPACETRACK_PASSWORD' => 'correct-horse-battery',
            'SPACED_TRACKER_DEMO' => '1',
            'SPACED_TRACKER_CACHE_DIR' => $directory,
            'SPACED_TRACKER_CACHE_TTL' => 'nope',
        ]);

        $health = $this->json($front->handle($this->request('GET', '/api/health')));
        $catalog = $this->json($front->handle($this->request('GET', '/api/satcat')));

        self::assertSame('demo', $health['mode']);
        self::assertGreaterThan(0, $catalog['count']);
        self::assertDirectoryDoesNotExist($directory);
    }

    public function testCacheTtlMustBeAPositiveInteger(): void
    {
        $directory = $this->cacheDir();
        try {
            FrontController::fromEnvironment([
                'SPACETRACK_IDENTITY' => 'ada@example.com',
                'SPACETRACK_PASSWORD' => 'correct-horse-battery',
                'SPACED_TRACKER_CACHE_DIR' => $directory,
                'SPACED_TRACKER_CACHE_TTL' => '0',
            ]);
            self::fail('A zero cache TTL must be rejected.');
        } catch (\InvalidArgumentException $exception) {
            self::assertStringContainsString('SPACED_TRACKER_CACHE_TTL', $exception->getMessage());
        }

        self::assertDirectoryDoesNotExist($directory);
    }

    private function front(): FrontController
    {
        return new FrontController(
            Application::fromEnvironment(['SPACETRACK_IDENTITY' => '']),
            $this->publicDir,
        );
    }

    private function request(string $method, string $path, ?string $body = null): \Psr\Http\Message\ServerRequestInterface
    {
        $factory = new Psr17Factory();
        $request = $factory->createServerRequest($method, $factory->createUri('http://127.0.0.1' . $path));
        if ($body === null) {
            return $request;
        }

        return $request
            ->withHeader('Content-Type', 'application/json')
            ->withBody($factory->createStream($body));
    }

    /**
     * @return array<string, mixed>
     */
    private function json(\Psr\Http\Message\ResponseInterface $response): array
    {
        self::assertSame(200, $response->getStatusCode());
        $decoded = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        return $decoded;
    }

    /**
     * @param array<string, string> $extra
     * @param list<\Psr\Http\Message\ResponseInterface> $responses
     * @return array{front: FrontController, http: MockHttpClient, clock: FrozenClock, dir: string}
     */
    private function live(array $extra, array $responses): array
    {
        $directory = $this->cacheDir();
        $clock = new FrozenClock(new \DateTimeImmutable('now'));
        $http = new MockHttpClient($responses);
        $front = FrontController::fromEnvironment($extra + [
            'SPACETRACK_IDENTITY' => 'ada@example.com',
            'SPACETRACK_PASSWORD' => 'correct-horse-battery',
            'SPACETRACK_BASE_URL' => 'https://example.test',
            'SPACED_TRACKER_CACHE_DIR' => $directory,
        ], $http, $clock);

        return [
            'front' => $front,
            'http' => $http,
            'clock' => $clock,
            'dir' => $directory,
        ];
    }

    private function cacheDir(): string
    {
        $directory = sys_get_temp_dir() . '/spaced-ui-cache-' . bin2hex(random_bytes(4));
        $this->cacheDirs[] = $directory;

        return $directory;
    }

    /**
     * @return array{text: string, expires: list<int>}
     */
    private function cacheEntries(string $directory): array
    {
        self::assertDirectoryExists($directory);
        $text = '';
        $expires = [];
        $entries = scandir($directory);
        self::assertIsArray($entries);
        foreach ($entries as $entry) {
            if (preg_match('/^[a-f0-9]{64}\.json$/', $entry) !== 1) {
                continue;
            }
            $raw = (string) file_get_contents($directory . '/' . $entry);
            $text .= $raw;
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            self::assertIsArray($decoded);
            self::assertArrayHasKey('expires_at', $decoded);
            self::assertIsInt($decoded['expires_at']);
            $expires[] = $decoded['expires_at'];
        }

        return ['text' => $text, 'expires' => $expires];
    }

    private function catalogQuery(): string
    {
        return json_encode([
            'class' => 'gp',
            'where' => ['NORAD_CAT_ID' => 25544],
            'limit' => 1,
        ], JSON_THROW_ON_ERROR);
    }

    private function loginResponse(): \Psr\Http\Message\ResponseInterface
    {
        $factory = new Psr17Factory();

        return $factory->createResponse(200)
            ->withHeader('Set-Cookie', 'chocolatechip=session-token; Path=/; HttpOnly; Max-Age=7200');
    }

    private function jsonResponse(string $body): \Psr\Http\Message\ResponseInterface
    {
        $factory = new Psr17Factory();

        return $factory->createResponse(200)->withBody($factory->createStream($body));
    }

    private function remove(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        }
        rmdir($directory);
    }

    private function capture(callable $call): string
    {
        ob_start();
        try {
            $call();
        } finally {
            $body = ob_get_clean();
        }

        return is_string($body) ? $body : '';
    }

    /**
     * @param callable(int): void $assert
     */
    private function withServer(string $router, callable $assert): void
    {
        $log = $router . '.log';
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, $error);
        $address = stream_socket_get_name($socket, false);
        self::assertIsString($address);
        fclose($socket);
        $port = (int) substr($address, (int) strrpos($address, ':') + 1);
        $command = [PHP_BINARY, '-S', '127.0.0.1:' . $port, $router];
        $process = proc_open(
            $command,
            [
                0 => ['pipe', 'r'],
                1 => ['file', $log, 'wb'],
                2 => ['file', $log, 'wb'],
            ],
            $pipes,
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        try {
            $deadline = microtime(true) + 3;
            $listening = false;
            while (microtime(true) < $deadline) {
                $connection = @fsockopen('127.0.0.1', $port, $errno, $error, 0.1);
                if (is_resource($connection)) {
                    fclose($connection);
                    $listening = true;
                    break;
                }
                usleep(50000);
            }
            if (!$listening) {
                $output = is_file($log) ? (string) file_get_contents($log) : '';
                self::fail('The local UI server did not start. ' . $output);
            }
            $assert($port);
        } finally {
            proc_terminate($process);
            proc_close($process);
            if (is_file($log)) {
                unlink($log);
            }
        }
    }

    /**
     * @return array{status: int, headers: string, body: string}
     */
    private function curl(int $port, string $path): array
    {
        $headerFile = sys_get_temp_dir() . '/spaced-ui-headers-' . bin2hex(random_bytes(4));
        $bodyFile = $headerFile . '.body';
        $stderrFile = $headerFile . '.err';
        $process = proc_open(
            ['curl', '-sS', '--max-time', '5', '-D', $headerFile, '-o', $bodyFile, 'http://127.0.0.1:' . $port . $path],
            [1 => ['file', $stderrFile, 'wb'], 2 => ['file', $stderrFile, 'ab']],
            $pipes,
        );
        self::assertIsResource($process);
        $exit = proc_close($process);
        $stderr = is_file($stderrFile) ? (string) file_get_contents($stderrFile) : '';
        $headerText = is_file($headerFile) ? (string) file_get_contents($headerFile) : '';
        $response = is_file($bodyFile) ? (string) file_get_contents($bodyFile) : '';
        if (is_file($headerFile)) {
            unlink($headerFile);
        }
        if (is_file($bodyFile)) {
            unlink($bodyFile);
        }
        if (is_file($stderrFile)) {
            unlink($stderrFile);
        }
        self::assertSame(0, $exit, $stderr);
        self::assertSame(1, preg_match('/^HTTP\/\S+\s+(\d+)/', $headerText, $status), $headerText);

        return [
            'status' => (int) $status[1],
            'headers' => $headerText,
            'body' => $response,
        ];
    }
}
