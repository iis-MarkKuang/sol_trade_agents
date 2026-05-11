import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CrawlersModule } from './crawlers/crawlers.module';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [ConfigModule, PrismaModule, CrawlersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
