import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

@Injectable()
export class EventsService {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  stream(sessionId: string): Observable<MessageEvent> {
    return this.getSubject(sessionId).asObservable();
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

