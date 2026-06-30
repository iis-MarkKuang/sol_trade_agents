import { Module } from '@nestjs/common';
import { CoinmarketcapCrawlerService } from './coinmarketcap-crawler.service';
import { TradingviewCrawlerService } from './tradingview-crawler.service';
import { DuneCrawlerService } from './dune-crawler.service';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [CoinmarketcapCrawlerService, TradingviewCrawlerService, DuneCrawlerService],
  exports: [CoinmarketcapCrawlerService, TradingviewCrawlerService, DuneCrawlerService],
})
export class CrawlersModule {}
