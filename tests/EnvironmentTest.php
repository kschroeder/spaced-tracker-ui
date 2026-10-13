<?php

declare(strict_types=1);

namespace SpacedTracker\Ui\Tests;

use Dotenv\Exception\InvalidFileException;
use SpacedTracker\Testing\MockHttpClient;
use SpacedTracker\Ui\Environment;
use SpacedTracker\Ui\FrontController;
use Nyholm\Psr7\Factory\Psr17Factory;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ServerRequestInterface;

final class EnvironmentTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/spaced-ui-env-' . bin2hex(random_bytes(4));
        mkdir($this->root);
    }

    protected function tearDown(): void
    {
        $env = $this->root . '/.env';
        if (is_file($env)) {
            unlink($env);
        }
        if (is_dir($this->root)) {
            rmdir($this->root);
        }
    }

    public function testEnvFileFillsMissingKeysAndDoesNotOverrideTheProcess(): void
    {
        $this->writeEnv("SPACETRACK_IDENTITY=from-file\nSPACETRACK_PASSWORD=file-secret\nSPACED_TRACKER_DEMO=1\nSPACED_TRACKER_API_TOKEN=from-file\n");
        $env = Environment::load($this->root, [
            'SPACETRACK_IDENTITY' => 'from-process',
            'SPACETRACK_PASSWORD' => 'process-secret',
            'SPACED_TRACKER_PORT' => '',
        ]);

        self::assertSame('from-process', $env['SPACETRACK_IDENTITY']);
        self::assertSame('process-secret', $env['SPACETRACK_PASSWORD']);
        self::assertSame('', $env['SPACED_TRACKER_PORT']);
        self::assertSame('1', $env['SPACED_TRACKER_DEMO']);
        self::assertSame('from-file', $env['SPACED_TRACKER_API_TOKEN']);
    }

    public function testMissingEnvFileLeavesTheBaseEnvironmentAlone(): void
    {
        self::assertSame(['SPACED_TRACKER_HOST' => 'localhost'], Environment::load($this->root, [
            'SPACED_TRACKER_HOST' => 'localhost',
        ]));
    }

    public function testDotenvSelectsDemoModeAndABearerToken(): void
    {
        $this->writeEnv("SPACETRACK_IDENTITY=operator@example.com\nSPACETRACK_PASSWORD=secret\nSPACED_TRACKER_DEMO=1\nSPACED_TRACKER_API_TOKEN=dotenv-token\n");
        $health = $this->json($this->front()->handle($this->request('GET', '/api/health')));

        self::assertSame('demo', $health['mode']);
        self::assertSame('bearer', $health['auth']);
    }

    public function testDotenvSelectsLiveModeWithoutCallingSpaceTrack(): void
    {
        $this->writeEnv("SPACETRACK_IDENTITY=operator@example.com\nSPACETRACK_PASSWORD=secret\n");
        $cache = $this->root . '/cache';
        $http = new MockHttpClient([]);
        $env = Environment::load($this->root, []) + ['SPACED_TRACKER_CACHE_DIR' => $cache];
        try {
            $front = FrontController::fromEnvironment($env, $http);
            $health = $this->json($front->handle($this->request('GET', '/api/health')));
        } finally {
            $this->remove($cache);
        }

        self::assertSame('live', $health['mode']);
        self::assertSame('open', $health['auth']);
        self::assertSame([], $http->requests);
    }

    public function testEmptyBaseWithoutAnEnvFileRunsDemoMode(): void
    {
        $health = $this->json($this->front()->handle($this->request('GET', '/api/health')));

        self::assertSame('demo', $health['mode']);
    }

    public function testAMalformedEnvFileIsRejected(): void
    {
        $this->writeEnv("BAD NAME=value\n");
        $this->expectException(InvalidFileException::class);
        Environment::load($this->root, []);
    }

    private function front(): FrontController
    {
        return FrontController::fromEnvironment(Environment::load($this->root, []));
    }

    private function writeEnv(string $contents): void
    {
        file_put_contents($this->root . '/.env', $contents);
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

    private function request(string $method, string $path): ServerRequestInterface
    {
        return (new Psr17Factory())->createServerRequest($method, 'http://127.0.0.1' . $path);
    }

    /**
     * @return array<string, mixed>
     */
    private function json(\Psr\Http\Message\ResponseInterface $response): array
    {
        $decoded = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded);

        return $decoded;
    }
}
