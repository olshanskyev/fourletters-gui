/** A reactor's latest reaction; an empty emoji is a removal tombstone. */
export interface MessageReaction {
  emoji: string;
  ts: number;
}

/** Plaintext reaction wire body, sent as `0.<json>`. */
export interface ReactionPayload {
  kind: 'reaction';
  target: string;
  emoji: string;
  ts: number;
}

export const REACTION_PAYLOAD_PREFIX = '0.';

export const REACTION_EMOJIS: readonly string[] = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '👎', '🔥', '🎉', '👏',
];
