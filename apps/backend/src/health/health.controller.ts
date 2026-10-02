import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../database/types';
import { KYSELY } from '../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Get()
  async health() {
    try {
      await sql`select 1`.execute(this.db);
      return { ok: true, database: true };
    } catch {
      throw new ServiceUnavailableException({
        ok: false,
        database: false,
      });
    }
  }
}
