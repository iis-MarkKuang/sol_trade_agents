import { Module } from '@nestjs/common';
import { DataCleanerService } from './data-cleaner.service';
import { DataNormalizerService } from './data-normalizer.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [DataCleanerService, DataNormalizerService],
  exports: [DataCleanerService, DataNormalizerService],
})
export class DataModule {}
