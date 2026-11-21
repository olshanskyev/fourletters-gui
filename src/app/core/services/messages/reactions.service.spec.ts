import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EncryptedMessage, MessageHint } from '@dto/models';
import { AuthService } from '@core/services/authentication/auth.service';
import { MessagesApiService } from './messages-api.service';
import { MessagesRepository } from './messages.repository';
import { DirectMessage, GroupMessage, LocalMessage } from './models/messages.model';
import { ReactionsService } from './reactions.service';

const ME = 'me-id';
const PEER = 'peer-id';
const GROUP = 'group-id';

function direct(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: 'msg-1', conversationId: 'c-1', senderId: PEER, recipientId: ME, text: '',
    isMine: false, createdAt: 1, kind: 'direct', ...overrides,
  };
}

function group(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 'msg-2', conversationId: 'c-2', senderId: PEER, groupId: GROUP, text: '',
    isMine: false, createdAt: 1, kind: 'group', ...overrides,
  };
}

function incoming(
  body: object, senderId = PEER, groupId?: string
): EncryptedMessage {
  return { messageId: 'r-1', senderId, groupId, payload: '0.' + JSON.stringify(body) };
}

describe('ReactionsService', () => {
  let service: ReactionsService;
  let messages: Map<string, LocalMessage>;
  let repository: {
    getMessageById: ReturnType<typeof vi.fn>;
    setReaction: ReturnType<typeof vi.fn>;
  };
  let api: { sendMessage: ReturnType<typeof vi.fn>; sendGroupMessage: ReturnType<typeof vi.fn> };

  const sentPayload = (mock: ReturnType<typeof vi.fn>) =>
    JSON.parse((mock.mock.calls[0][1] as string).slice(2));

  beforeEach(() => {
    messages = new Map();
    repository = {
      getMessageById: vi.fn(async (id: string) => messages.get(id)),
      setReaction: vi.fn(async () => true),
    };
    api = {
      sendMessage: vi.fn(() => of({})),
      sendGroupMessage: vi.fn(() => of({})),
    };
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { currentUser: () => ({ id: ME }) } },
        { provide: MessagesRepository, useValue: repository },
        { provide: MessagesApiService, useValue: api },
        { provide: ReactionsService, useClass: ReactionsService, deps: [] },
      ],
    });
    service = injector.get(ReactionsService);
  });

  describe('react', () => {
    it('sends a direct reaction to the peer, pushing the message author', async () => {
      await service.react(direct(), '👍');

      const [peer, payload, , groupId, hint] = api.sendMessage.mock.calls[0];
      expect(peer).toBe(PEER);
      expect(groupId).toBeUndefined();
      expect(hint).toBe(MessageHint.Reaction);
      expect((payload as string).startsWith('0.')).toBe(true);
      expect(sentPayload(api.sendMessage)).toMatchObject(
        { kind: 'reaction', target: 'msg-1', emoji: '👍', notifyId: PEER }
      );
      expect(repository.setReaction).toHaveBeenCalledWith(
        'msg-1', ME, expect.objectContaining({ emoji: '👍' }), true
      );
    });

    it('targets the recipient and pushes no one when reacting to an own message', async () => {
      await service.react(direct({ isMine: true, senderId: ME, recipientId: PEER }), '🔥');

      expect(api.sendMessage.mock.calls[0][0]).toBe(PEER);
      expect(sentPayload(api.sendMessage).notifyId).toBeUndefined();
    });

    it('sends a group reaction once to the group, pushing the message author', async () => {
      await service.react(group(), '🎉');

      const [groupId, , , hint] = api.sendGroupMessage.mock.calls[0];
      expect(groupId).toBe(GROUP);
      expect(hint).toBe(MessageHint.Reaction);
      expect(sentPayload(api.sendGroupMessage).notifyId).toBe(PEER);
    });

    it('removes the reaction when the same emoji is picked again', async () => {
      await service.react(direct({ reactions: { [ME]: { emoji: '👍', ts: 1 } } }), '👍');

      expect(sentPayload(api.sendMessage).emoji).toBe('');
    });

    it('replaces a different previous emoji', async () => {
      await service.react(direct({ reactions: { [ME]: { emoji: '👍', ts: 1 } } }), '❤️');

      expect(sentPayload(api.sendMessage).emoji).toBe('❤️');
    });

    it('reverts the local reaction when sending fails', async () => {
      api.sendMessage.mockReturnValue(throwError(() => new Error('offline')));
      const previous = { emoji: '👍', ts: 1 };

      await expect(service.react(direct({ reactions: { [ME]: previous } }), '😂'))
        .rejects.toThrow('offline');
      expect(repository.setReaction).toHaveBeenLastCalledWith('msg-1', ME, previous, true);
    });

    it('ignores unknown emojis', async () => {
      await service.react(direct(), '💩');

      expect(api.sendMessage).not.toHaveBeenCalled();
      expect(repository.setReaction).not.toHaveBeenCalled();
    });
  });

  describe('applyIncoming', () => {
    const body = { kind: 'reaction', target: 'msg-1', emoji: '👍', ts: 5 };

    it('applies a valid direct reaction without forcing', async () => {
      messages.set('msg-1', direct({ isMine: true, senderId: ME, recipientId: PEER }));

      await service.applyIncoming(incoming(body));

      expect(repository.setReaction).toHaveBeenCalledWith('msg-1', PEER, { emoji: '👍', ts: 5 });
    });

    it('applies a valid group reaction', async () => {
      messages.set('msg-2', group());

      await service.applyIncoming(incoming({ ...body, target: 'msg-2' }, 'other', GROUP));

      expect(repository.setReaction).toHaveBeenCalledWith('msg-2', 'other', { emoji: '👍', ts: 5 });
    });

    it('drops a reaction from another conversation', async () => {
      messages.set('msg-1', direct({ senderId: 'someone-else' }));
      messages.set('msg-2', group({ groupId: 'other-group' }));

      await service.applyIncoming(incoming(body));
      await service.applyIncoming(incoming({ ...body, target: 'msg-2' }, PEER, GROUP));

      expect(repository.setReaction).not.toHaveBeenCalled();
    });

    it('drops unknown targets, emojis and malformed payloads', async () => {
      messages.set('msg-1', direct());

      await service.applyIncoming(incoming({ ...body, target: 'missing' }));
      await service.applyIncoming(incoming({ ...body, emoji: '💩' }));
      await service.applyIncoming(incoming({ ...body, ts: 'later' }));
      await service.applyIncoming({ messageId: 'r', senderId: PEER, payload: '0.{not json' });

      expect(repository.setReaction).not.toHaveBeenCalled();
    });
  });
});
