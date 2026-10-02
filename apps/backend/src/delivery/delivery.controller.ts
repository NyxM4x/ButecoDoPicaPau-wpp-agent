import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ServiceAuthGuard } from '../common/guards/service-auth.guard';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { QrCheckoutService } from '../bank-qr/qr-checkout.service';
import { DeliveryService } from './delivery.service';
import { QuoteDeliveryDto } from './dto/quote-delivery.dto';
import { ManualQuoteDto } from './dto/manual-quote.dto';

@Controller()
@UseGuards(ServiceAuthGuard)
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly qrCheckout: QrCheckoutService,
  ) {}

  @Post('delivery/quotes')
  quoteStandalone(@Body() dto: QuoteDeliveryDto, @IdempotencyKey() idempotencyKey: string) {
    return this.delivery.quoteStandalone(dto, idempotencyKey);
  }

  @Post('orders/:id/delivery/quote')
  async quoteForOrder(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.delivery.quoteForOrder(id);
    if (result.result === 'applied') {
      await this.qrCheckout.notifyIfReady(id);
    }
    return result;
  }

  @Post('orders/:id/delivery/quote/manual')
  async setManualQuote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualQuoteDto) {
    const result = await this.delivery.setManualQuote(id, dto.amount);
    if (result.result === 'applied') {
      await this.qrCheckout.notifyIfReady(id);
    }
    return result;
  }
}
