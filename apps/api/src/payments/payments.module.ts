import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * M14-W1 — payments domain core. No HTTP surface yet: the student
 * initiation endpoint arrives with the gateway adapter (W2) and the
 * webhook controller with W3. Keeping W1 transport-free lets the
 * settlement invariants be tested in isolation.
 */
@Module({
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
