import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { SafepayAdapter } from './safepay.adapter';
import { PAYMENT_GATEWAY } from './gateway.adapter';

/**
 * M14 payments domain. W1: transport-free settlement core. W2: the
 * gateway adapter boundary (PAYMENT_GATEWAY token — tests inject a fake,
 * mirroring MAIL_TRANSPORT) and the student initiation endpoint. The
 * webhook controller arrives in W3.
 */
@Module({
  imports: [FeesModule],
  controllers: [PaymentsController, PaymentsWebhookController, RefundsController],
  providers: [
    PaymentsService,
    RefundsService,
    { provide: PAYMENT_GATEWAY, useClass: SafepayAdapter },
  ],
  exports: [PaymentsService, PAYMENT_GATEWAY],
})
export class PaymentsModule {}
