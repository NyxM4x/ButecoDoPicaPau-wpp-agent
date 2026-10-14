import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../config/configuration';
import { AgentWakeRouteName, wakeAgent } from './agent-wake';

/**
 * Despierta al agente de WhatsApp cada minuto. Ver `agent-wake.ts`.
 *
 * Sin `AGENT_INTERNAL_TOKEN` no llama a nada: es lo que pasa en local, donde
 * el agente no tiene sus colas configuradas.
 */
@Injectable()
export class AgentWakeCron {
  private readonly logger = new Logger(AgentWakeCron.name);
  /** Una pasada dura como mucho 55 s; si se alarga, la siguiente no se le encima. */
  private running = false;
  /** Lo último que pasó con cada ruta, para avisar solo cuando CAMBIA. */
  private readonly lastError = new Map<AgentWakeRouteName, string>();
  private warnedNotConfigured = false;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    const { token } = this.config.get('agentWake', { infer: true });
    const { baseUrl } = this.config.get('gateway', { infer: true });
    if (!token || !baseUrl) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.logger.warn(
          'El despertador del agente está apagado: falta AGENT_INTERNAL_TOKEN o GATEWAY_BASE_URL.',
        );
      }
      return;
    }
    if (this.running) return;

    this.running = true;
    try {
      for (const result of await wakeAgent({ baseUrl, token })) {
        const previous = this.lastError.get(result.name);
        if (result.ok) {
          if (previous) this.logger.log(`El agente volvió a responder en ${result.name}.`);
          this.lastError.delete(result.name);
        } else if (previous !== result.error) {
          // Una vez por cambio, no una vez por minuto: un agente caído una
          // hora no puede llenar el registro con sesenta líneas iguales.
          this.logger.warn(`El agente no completó ${result.name}: ${result.error}.`);
          this.lastError.set(result.name, result.error ?? 'unknown');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
