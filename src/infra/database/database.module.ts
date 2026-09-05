import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import knex, { Knex } from 'knex';
import { AppConfig } from '../../config/configuration';

export const KNEX = Symbol('KNEX');

function buildKnex(db: AppConfig['db'], poolMin = 0, poolMax = 10): Knex {
  return knex({
    client: 'pg',
    connection: {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
    },
    pool: { min: poolMin, max: poolMax },
  });
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KNEX,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Knex => buildKnex(cfg.get<AppConfig>('app')!.db),
    },
  ],
  exports: [KNEX],
})
export class DatabaseModule {
  /** 供 CLI/测试直接构造连接（不经过 Nest 容器） */
  static buildKnex = buildKnex;
}