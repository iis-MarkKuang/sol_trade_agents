import { Global, Module } from '@nestjs/common';
import { UsageLedgerService } from './usage-ledger.service';
import { UsageController } from './usage.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ConfigModule } from '../config/config.module';

@Global()
@Module({
  imports: [PrismaModule, RedisModule, ConfigModule],
  providers: [UsageLedgerService],
  controllers: [UsageController],
  exports: [UsageLedgerService],
})
export class UsageLedgerModule {}
