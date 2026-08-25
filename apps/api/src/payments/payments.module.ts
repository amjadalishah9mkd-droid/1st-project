import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SafepayAdapter } from './safepay.adapter';
import { PAYMENT_GATEWAY } from './gateway.adapter';

/**
 * M14 payments domain. W1: transport-free settlement core. W2: the
 * gateway adapter boundary (PAYMENT_GATEWAY token — tests inject a fake,
 * mirroring MAIL_TRANSPORT) and the student initiation endpoint. The
 * webhook controller arrives in W3.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PAYMENT_GATEWAY, useClass: SafepayAdapter },
  ],
  exports: [PaymentsService, PAYMENT_GATEWAY],
})
export class PaymentsModule {}
