import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { ConfigService } from '../config/config.service';

// Factory mock: all mock state is created inside the factory to avoid jest
// hoisting issues. The fake client is exposed as a property for test access.
jest.mock('ioredis', () => {
  const fakeClient = {
    ping: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
  return {
    Redis: jest.fn(() => fakeClient),
    __fakeClient: fakeClient,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ioredisMock = require('ioredis') as {
  Redis: jest.Mock;
  __fakeClient: { ping: jest.Mock; quit: jest.Mock; on: jest.Mock };
};

describe('RedisService', () => {
  let module: TestingModule;
  let service: RedisService;

  beforeEach(async () => {
    ioredisMock.__fakeClient.ping.mockReset();
    ioredisMock.__fakeClient.quit.mockReset();
    ioredisMock.__fakeClient.on.mockReset();
    ioredisMock.Redis.mockClear();

    module = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: { redisUrl: 'redis://test:6379' } },
      ],
    }).compile();

    service = module.get(RedisService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('constructs the client from ConfigService.redisUrl', () => {
    expect(ioredisMock.Redis).toHaveBeenCalledWith(
      'redis://test:6379',
      expect.objectContaining({
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      }),
    );
  });

  it('health() returns true on PONG', async () => {
    ioredisMock.__fakeClient.ping.mockResolvedValue('PONG');
    await expect(service.health()).resolves.toBe(true);
    expect(ioredisMock.__fakeClient.ping).toHaveBeenCalledTimes(1);
  });

  it('health() returns false and does not throw on error', async () => {
    ioredisMock.__fakeClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.health()).resolves.toBe(false);
  });

  it('onModuleDestroy calls quit()', async () => {
    ioredisMock.__fakeClient.quit.mockResolvedValue('OK');
    await service.onModuleDestroy();
    expect(ioredisMock.__fakeClient.quit).toHaveBeenCalledTimes(1);
  });
});
