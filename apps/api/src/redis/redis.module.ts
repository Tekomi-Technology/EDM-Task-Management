import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

/** One Redis connection for fast-changing data (latest staff positions). Queues use their own. */
@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: (env: Env) => new IORedis(env.REDIS_URL), inject: [ENV] }],
  exports: [REDIS]
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
