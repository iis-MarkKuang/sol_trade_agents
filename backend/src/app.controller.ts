import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { CoinmarketcapCrawlerService } from './crawlers/coinmarketcap-crawler.service';
import { TradingviewCrawlerService } from './crawlers/tradingview-crawler.service';
import { DuneCrawlerService } from './crawlers/dune-crawler.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly cmcCrawler: CoinmarketcapCrawlerService,
    private readonly tvCrawler: TradingviewCrawlerService,
    private readonly duneCrawler: DuneCrawlerService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): { status: string; timestamp: Date } {
    return {
      status: 'ok',
      timestamp: new Date(),
    };
  }

  @Post('crawl/coinmarketcap')
  async crawlCoinMarketCap() {
    return await this.cmcCrawler.run(20);
  }

  @Post('crawl/tradingview')
  async crawlTradingView() {
    return await this.tvCrawler.run();
  }

  @Post('crawl/dune')
  async crawlDune() {
    return await this.duneCrawler.run();
  }

  @Post('crawl/all')
  async crawlAll() {
    const [cmcData, tvData, duneData] = await Promise.all([
      this.cmcCrawler.run(10),
      this.tvCrawler.run(),
      this.duneCrawler.run(),
    ]);
    return {
      coinmarketcap: cmcData,
      tradingview: tvData,
      dune: duneData,
    };
  }
}
