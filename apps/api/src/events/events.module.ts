import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent } from '@campusos/shared';

/**
 * Typed domain-event bus (Blueprint §10).
 * Services emit AFTER their database transaction commits. Listeners
 * (notifications, future channels) subscribe by event type string.
 */
@Injectable()
export class EventsService {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }
}

@Global()
@Module({
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
