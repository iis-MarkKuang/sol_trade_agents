import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const ConfigSchema = z.object({
  COINMARKETCAP_API_KEY: z.string().optional(),
  DUNE_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

@Injectable()
export class ConfigService {
  private config: z.infer<typeof ConfigSchema>;

  constructor() {
    this.config = ConfigSchema.parse(process.env);
  }

  get coinmarketcapApiKey() {
    return this.config.COINMARKETCAP_API_KEY;
  }

  get duneApiKey() {
    return this.config.DUNE_API_KEY;
  }

  get redisUrl() {
    return this.config.REDIS_URL;
  }

  get isProduction() {
    return this.config.NODE_ENV === 'production';
  }
}
