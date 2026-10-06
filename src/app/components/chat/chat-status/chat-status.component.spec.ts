import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '@core/services/authentication/auth.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { UsersService } from '@core/services/users/users.service';
import { PresenceEvent, TypingEvent, TypingEventTypeEnum } from '@dto/models';
import { ChatStatusComponent } from './chat-status.component';

describe('ChatStatusComponent', () => {
  const typing = new Subject<TypingEvent>();
  const presence = new Subject<PresenceEvent>();
  const hub = {
    typing, presence, connectionState: signal('connected'),
    subscribePresence: vi.fn(), unsubscribePresence: vi.fn(),
    subscribeGroupTyping: vi.fn(), unsubscribeGroupTyping: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hub.connectionState.set('connected');
    TestBed.configureTestingModule({
      imports: [ChatStatusComponent, TranslateModule.forRoot()],
      providers: [
        { provide: HubService, useValue: hub },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'self' }) } },
        { provide: UsersService, useValue: {
          getProfile: async (id: string) => ({ username: id }),
        } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function event(userId: string, groupId?: string) {
    typing.next({ type: TypingEventTypeEnum.Typing, userId, groupId });
  }

  it('replaces the group typer and renews the single timeout', () => {
    const fixture = TestBed.createComponent(ChatStatusComponent);
    fixture.componentRef.setInput('groupId', 'group');
    fixture.detectChanges();
    vi.useFakeTimers();
    event('X', 'group');
    vi.advanceTimersByTime(2000);
    event('Y', 'group');
    vi.advanceTimersByTime(1000);
    expect(fixture.componentInstance.typingUserId()).toBe('Y');
    vi.advanceTimersByTime(2000);
    expect(fixture.componentInstance.typingUserId()).toBeUndefined();
  });

  it('filters other destinations and self, and clears on disconnect', () => {
    const fixture = TestBed.createComponent(ChatStatusComponent);
    fixture.componentRef.setInput('groupId', 'group');
    fixture.detectChanges();
    event('X', 'group');
    event('self', 'group');
    event('Y', 'other');
    event('Y');
    expect(fixture.componentInstance.typingUserId()).toBe('X');
    hub.connectionState.set('disconnected');
    fixture.detectChanges();
    expect(fixture.componentInstance.typingUserId()).toBeUndefined();
  });

  it('changes subscriptions and cleans up on destroy', () => {
    const fixture = TestBed.createComponent(ChatStatusComponent);
    fixture.componentRef.setInput('peerId', 'peer');
    fixture.detectChanges();
    expect(hub.subscribePresence).toHaveBeenCalledWith('peer');
    event('peer');
    expect(fixture.componentInstance.typingUserId()).toBe('peer');
    fixture.componentRef.setInput('peerId', undefined);
    fixture.componentRef.setInput('groupId', 'group');
    fixture.detectChanges();
    expect(hub.unsubscribePresence).toHaveBeenCalledWith('peer');
    expect(hub.subscribeGroupTyping).toHaveBeenCalledWith('group');
    expect(fixture.componentInstance.typingUserId()).toBeUndefined();
    fixture.destroy();
    expect(hub.unsubscribeGroupTyping).toHaveBeenCalledWith('group');
  });
});