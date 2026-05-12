import { Test, TestingModule } from '@nestjs/testing';
import { DuneCrawlerService } from './dune-crawler.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

const mockConfigService = { duneApiKey: 'test-key' };
const mockPrismaService = {
  marketData: { create: jest.fn() },
};

describe('DuneCrawlerService', () => {
  let service: DuneCrawlerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuneCrawlerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<DuneCrawlerService>(DuneCrawlerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('transformToCrawledData', () => {
    it('should transform on-chain data correctly', () => {
      const mockData = [
        { token: 'solana', symbol: 'SOL', tvl: 2000000000, activeAddresses: 450000 },
      ];
      const result = service.transformToCrawledData(mockData);
      expect(result[0].token).toBe('solana');
      expect(result[0].source).toBe('dune');
      expect(result[0].tvl).toBe(2000000000);
      expect(result[0].activeAddresses).toBe(450000);
    });
  });
});
