import { createHash } from 'node:crypto';
import { redactSensitiveText } from '../utils/errors.js';

/**
 * Generates tamper-evident, sanitized ticket transcripts from Yapin channel message history.
 * Never persists raw bot tokens or secrets inside stored transcripts.
 */
export class TranscriptService {
  /**
   * @param {{ messagesApi?: import('../api/messages.js').YapinMessagesApi | null }} [deps]
   */
  constructor({ messagesApi = null } = {}) {
    this.messagesApi = messagesApi;
  }

  /**
   * Fetches up to `maxMessages` from a Yapin ticket channel and produces a structured,
   * SHA-256 checksummed transcript object suitable for MongoDB storage.
   *
   * @param {{ channelId: string | null, generatedBy: string, fallbackNotes?: Array<object>, maxMessages?: number }} params
   */
  async buildTranscript({ channelId, generatedBy, fallbackNotes = [], maxMessages = 300 }) {
    const entries = [];

    if (channelId && this.messagesApi) {
      const rawMessages = await this.messagesApi
        .fetchChannelTranscriptMessages(channelId, { maxMessages })
        .catch(() => []);

      for (const msg of rawMessages) {
        entries.push({
          messageId: String(msg.id || ''),
          authorId: String(msg.author_id || msg.author?.id || 'UNKNOWN'),
          authorUsername: msg.author?.username || msg.author?.display_name || null,
          content: redactSensitiveText(String(msg.content || '')).slice(0, 2000),
          createdAt: msg.created_at ? new Date(msg.created_at) : new Date(),
        });
      }
    }

    // Include recorded ticket notes if channel had no messages or operated in channel-less mode
    for (const note of fallbackNotes) {
      entries.push({
        messageId: String(note.noteId || 'note'),
        authorId: String(note.authorId || 'STAFF'),
        authorUsername: note.internalOnly ? '[INTERNAL_NOTE]' : '[TICKET_NOTE]',
        content: redactSensitiveText(String(note.content || '')).slice(0, 2000),
        createdAt: note.createdAt ? new Date(note.createdAt) : new Date(),
      });
    }

    const canonicalJson = JSON.stringify(
      entries.map((e) => ({
        m: e.messageId,
        a: e.authorId,
        c: e.content,
        t: new Date(e.createdAt).toISOString(),
      })),
    );

    const checksumSha256 = createHash('sha256').update(canonicalJson).digest('hex');

    return {
      messageCount: entries.length,
      generatedAt: new Date(),
      generatedBy: String(generatedBy),
      checksumSha256,
      entries,
    };
  }
}
