import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('WebSocket Gateway, Close-4003 Polling Fallback & Live Signed Webhook Receiver', () => {
  it('completes Gateway hello -> identify -> ready -> event dispatch and persists sequence cursor', async () => {
    const mock = createMockYapinFetch();
    const sentFrames = [];
    let savedCursor = 0;

    class MockGatewaySocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({ op: 'hello', heartbeat_interval: 30000 }),
          });
        }, 5);
      }

      send(raw) {
        const frame = JSON.parse(raw);
        sentFrames.push(frame);
        if (frame.op === 'identify' || frame.op === 'resume') {
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ op: 'ready' }) });
            this.onmessage?.({
              data: JSON.stringify({
                op: 'event',
                s: 205,
                t: 'message',
                d: {
                  id: 'gw_msg_1',
                  channel_id: 'ch_1',
                  server_id: mock.defaultServerId,
                  author_id: 'u_1',
                  content: '/ping',
                  command: 'ping',
                  args: '',
                },
              }),
            });
          }, 5);
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: 'closed' });
      }
    }

    const receivedMessages = [];
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      WebSocketImpl: MockGatewaySocket,
      cursorStore: {
        getCursor: async () => savedCursor,
        setCursor: async (seq) => {
          savedCursor = seq;
        },
      },
    });

    client.on('message', (ev) => receivedMessages.push(ev));

    await client.start();
    await new Promise((r) => setTimeout(r, 40));

    expect(sentFrames.some((f) => f.op === 'resume' || f.op === 'identify')).toBe(true);
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].id).toBe('gw_msg_1');
    expect(client.lastEventId).toBe(205);

    await client.stop();
    expect(savedCursor).toBe(205);
  });

  it('automatically falls back to HTTPS Long-Polling when Gateway closes with 4003 (disabled)', async () => {
    const mock = createMockYapinFetch();
    mock.state.events.push({
      id: 301,
      type: 'message',
      data: {
        id: 'poll_msg_301',
        channel_id: 'ch_1',
        server_id: mock.defaultServerId,
        author_id: 'u_2',
        content: 'hello via long-poll',
      },
    });

    class DisabledGatewaySocket {
      constructor() {
        setTimeout(() => {
          this.onclose?.({ code: 4003, reason: 'Gateway disabled for bot' });
        }, 5);
      }
      send() {}
      close() {}
    }

    const received = [];
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      WebSocketImpl: DisabledGatewaySocket,
      pollWaitSeconds: 0,
      cursorStore: {
        getCursor: async () => 100,
        setCursor: async () => {},
      },
    });

    client.on('message', (ev) => received.push(ev));
    await client.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(client.transport).toBe('polling');
    expect(received.some((m) => m.id === 'poll_msg_301')).toBe(true);
    await client.stop();
  });

  it('accepts valid HMAC-signed HTTP webhooks, deduplicates replayed event IDs, and rejects forged signatures', async () => {
    const mock = createMockYapinFetch();
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });

    const secret = 'whsec_live_http_test_secret_123456';
    const srv = await client.startWebhookServer({
      port: 0,
      host: '127.0.0.1',
      path: '/webhooks/yapin',
      secret,
    });
    const port = srv.address().port;
    const url = `http://127.0.0.1:${port}/webhooks/yapin`;

    const dispatched = [];
    client.on('message', (ev) => dispatched.push(ev));

    const payload = JSON.stringify({
      id: 777,
      type: 'message',
      data: { id: 'wh_msg_777', channel_id: 'ch_1', author_id: 'u_9', content: 'hi' },
    });
    const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

    // 1. Forged signature -> 401
    const badRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yapper-signature': 'sha256=0000' },
      body: payload,
    });
    expect(badRes.status).toBe(401);
    expect(dispatched).toHaveLength(0);

    // 2. Valid signature -> 200 & ingested once
    const okRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yapper-signature': sig },
      body: payload,
    });
    expect(okRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 15));
    expect(dispatched).toHaveLength(1);

    // 3. Replayed identical event ID 777 -> acknowledged 200 per webhook spec, but deduplicated (NOT dispatched twice!)
    const replayRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yapper-signature': sig },
      body: payload,
    });
    expect(replayRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 15));
    expect(dispatched).toHaveLength(1);

    await client.stop();
  });
});
