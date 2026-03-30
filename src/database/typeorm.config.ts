import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const typeOrmConfig = async (
  configService: ConfigService,
): Promise<TypeOrmModuleOptions> => {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';

  // Pool sizes per environment
  const poolSizes = {
    development: {
      poolSize: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 10000,
    },
    staging: {
      poolSize: 20,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 10000,
    },
    production: {
      poolSize: 50,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 10000,
    },
  };

  const envPoolSize = configService.get<number>('DB_POOL_SIZE');
  const envAcquireTimeout = configService.get<number>('DB_ACQUIRE_TIMEOUT_MILLIS');
  const envIdleTimeout = configService.get<number>('DB_IDLE_TIMEOUT_MILLIS');

  const poolConfig = poolSizes[nodeEnv] ?? poolSizes.development;

  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST') ?? 'localhost',
    port: configService.get<number>('DB_PORT') ?? 5432,
    username: configService.get<string>('DB_USERNAME') ?? 'postgres',
    password: configService.get<string>('DB_PASSWORD') ?? 'postgres',
    database: configService.get<string>('DB_NAME') ?? 'uzima',
    entities: [
      __dirname + '/../entities/*.entity{.ts,.js}',
      __dirname + '/../auth/entities/*.entity{.ts,.js}',
      __dirname + '/../tasks/entities/*.entity{.ts,.js}',
      __dirname + '/../task-completion/entities/*.entity{.ts,.js}',
      __dirname + '/../coupons/entities/*.entity{.ts,.js}',
      __dirname + '/../rewards/entities/*.entity{.ts,.js}',
      __dirname + '/../referral/entities/*.entity{.ts,.js}',
      __dirname + '/../notifications/entities/*.entity{.ts,.js}',
      __dirname + '/../audit/entities/*.entity{.ts,.js}',
      __dirname + '/../stellar/entities/*.entity{.ts,.js}',
      __dirname + '/../admin/entities/*.entity{.ts,.js}',
    ],
    synchronize: false,
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    logging: nodeEnv !== 'production',
    // Connection pool settings - poolSize is the main TypeORM option
    poolSize: envPoolSize ?? poolConfig.poolSize,
    // Additional driver-specific pool settings via extra
    extra: {
      // max connections in pool (same as poolSize)
      max: envPoolSize ?? poolConfig.poolSize,
      // Idle connection timeout in milliseconds
      idleTimeoutMillis: envIdleTimeout ?? poolConfig.idleTimeoutMillis,
      // Connection acquisition timeout in milliseconds
      connectionTimeoutMillis: envAcquireTimeout ?? poolConfig.acquireTimeoutMillis,
    },
  };
};
