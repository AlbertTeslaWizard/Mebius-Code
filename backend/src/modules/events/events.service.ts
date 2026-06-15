import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class EventsService {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  private readonly SSE_KEEPALIVE_MS = 5_000;

  stream(sessionId: string): Observable<MessageEvent> {
    const events$ = this.getSubject(sessionId).asObservable();
    const heartbeat$ = interval(this.SSE_KEEPALIVE_MS).pipe(
      map(() => ({ type: 'keepalive', data: {} }) as MessageEvent),
    );
    return merge(events$, heartbeat$);
  }

  publish(sessionId: string, type: string, data: Record<string, unknown>): void {
    this.getSubject(sessionId).next({ type, data });
  }

  complete(sessionId: string): void {
    this.getSubject(sessionId).next({ type: 'done', data: { sessionId } });
  }

  private getSubject(sessionId: string): Subject<MessageEvent> {
    const existing = this.subjects.get(sessionId);
    if (existing) {
      return existing;
    }

    const subject = new Subject<MessageEvent>();
    this.subjects.set(sessionId, subject);
    return subject;
  }
}
