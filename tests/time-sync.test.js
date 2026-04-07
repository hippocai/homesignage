/**
 * Unit tests for NTP-style server time synchronisation.
 *
 * Two areas under test:
 *   1. Server-side time-sync-request handler (socketService)
 *      – echoes t0, responds with serverTime ≈ Date.now()
 *   2. Client-side offset calculation algorithm
 *      – offset = serverTime - t0 - round(rtt / 2)
 *   3. getServerNow() semantics – applies offset to Date.now()
 */

// ---------------------------------------------------------------------------
// 1. Server-side handler
// ---------------------------------------------------------------------------

/**
 * The handler registered by socketService for each device socket:
 *
 *   socket.on('time-sync-request', (data) => {
 *     socket.emit('time-sync-response', {
 *       t0:         data && data.t0,
 *       serverTime: Date.now(),
 *     });
 *   });
 *
 * We test the logic directly using a minimal fake socket – no need to spin up
 * a full Socket.IO server.
 */
function registerTimeSyncHandler(socket) {
  socket.on('time-sync-request', (data) => {
    socket.emit('time-sync-response', {
      t0:         data && data.t0,
      serverTime: Date.now(),
    });
  });
}

function makeFakeSocket() {
  const handlers = {};
  const emitted  = [];
  return {
    on:      (event, fn) => { handlers[event] = fn; },
    emit:    (event, data) => { emitted.push({ event, data }); },
    trigger: (event, data) => { if (handlers[event]) handlers[event](data); },
    emitted,
  };
}

describe('Server time-sync-request handler', () => {
  it('emits time-sync-response with the echoed t0', () => {
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    const t0 = Date.now();
    socket.trigger('time-sync-request', { t0 });

    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0].event).toBe('time-sync-response');
    expect(socket.emitted[0].data.t0).toBe(t0);
  });

  it('includes serverTime >= t0', () => {
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    const t0 = Date.now();
    socket.trigger('time-sync-request', { t0 });

    const { serverTime } = socket.emitted[0].data;
    expect(serverTime).toBeGreaterThanOrEqual(t0);
  });

  it('serverTime is within a few milliseconds of Date.now()', () => {
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    const before = Date.now();
    socket.trigger('time-sync-request', { t0: before });
    const after = Date.now();

    const { serverTime } = socket.emitted[0].data;
    expect(serverTime).toBeGreaterThanOrEqual(before);
    expect(serverTime).toBeLessThanOrEqual(after + 5);
  });

  it('handles undefined data gracefully – t0 becomes undefined', () => {
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    socket.trigger('time-sync-request', undefined);

    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0].data.t0).toBeUndefined();
    expect(typeof socket.emitted[0].data.serverTime).toBe('number');
  });

  it('does not respond to unrelated events', () => {
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    socket.trigger('some-other-event', { t0: 123 });

    expect(socket.emitted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Client-side NTP offset calculation
// ---------------------------------------------------------------------------

/**
 * The formula used on the client:
 *
 *   const rtt    = t1 - t0;
 *   const offset = serverTime - t0 - Math.round(rtt / 2);
 *
 * After this, `Date.now() + offset` approximates the server's current time.
 */
function calcOffset(t0, serverTime, t1) {
  const rtt = t1 - t0;
  return serverTime - t0 - Math.round(rtt / 2);
}

describe('NTP offset calculation', () => {
  it('zero latency + server in sync → offset 0', () => {
    const t0 = 1_000_000;
    const t1 = t0;            // zero RTT
    const serverTime = t0;    // clocks identical
    expect(calcOffset(t0, serverTime, t1)).toBe(0);
  });

  it('zero latency + server 1000 ms ahead → offset +1000', () => {
    const t0 = 1_000_000;
    const t1 = t0;
    const serverTime = t0 + 1000;
    expect(calcOffset(t0, serverTime, t1)).toBe(1000);
  });

  it('zero latency + server 500 ms behind → offset -500', () => {
    const t0 = 5_000_000;
    const t1 = t0;
    const serverTime = t0 - 500;
    expect(calcOffset(t0, serverTime, t1)).toBe(-500);
  });

  it('compensates for symmetric network latency', () => {
    // RTT = 100 ms → one-way = 50 ms
    // At the moment the server handled the request, its clock read:
    //   serverTime = (true client time at t0) + serverAhead + 50 ms
    // Example: server is 1000 ms ahead of client, one-way = 50 ms
    const t0 = 0;
    const t1 = 100;           // 100 ms RTT
    const serverTime = 1050;  // server 1000 ms ahead; processed ~50 ms after t0
    expect(calcOffset(t0, serverTime, t1)).toBe(1000);
  });

  it('compensates for large latency (slow network)', () => {
    // RTT = 600 ms, server 2000 ms ahead
    const t0 = 0;
    const t1 = 600;
    const serverTime = 2300;  // 2000 + 300 (half RTT) ms after t0
    expect(calcOffset(t0, serverTime, t1)).toBe(2000);
  });

  it('handles odd RTT by rounding half-trip', () => {
    // RTT = 101 ms → Math.round(101/2) = 51
    const t0 = 0;
    const t1 = 101;
    const serverTime = 1051;  // server 1000 ms ahead; processed 51 ms after t0
    // offset = 1051 - 0 - 51 = 1000
    expect(calcOffset(t0, serverTime, t1)).toBe(1000);
  });

  it('produces stable result across multiple calls for same sync point', () => {
    const t0 = 9_000_000;
    const t1 = 9_000_200;
    const serverTime = 8_999_900; // server 200 ms behind client clock

    const offset = calcOffset(t0, serverTime, t1);
    // server is behind: offset should be negative
    expect(offset).toBeLessThan(0);
    // Applying offset: Date.now() + offset ≈ server time
    // At t1: t1 + offset should ≈ serverTime + 100 (half RTT elapsed since server read)
    expect(t1 + offset).toBeCloseTo(serverTime + 100, -1);
  });
});

// ---------------------------------------------------------------------------
// 3. getServerNow() semantics
// ---------------------------------------------------------------------------

/**
 * Client implementation:
 *
 *   var serverTimeOffset = 0;
 *
 *   function getServerNow() {
 *     return new Date(Date.now() + serverTimeOffset);
 *   }
 */
function makeGetServerNow(getOffset) {
  return function getServerNow(nowMs) {
    // nowMs lets us inject a fixed Date.now() in tests
    return new Date((nowMs !== undefined ? nowMs : Date.now()) + getOffset());
  };
}

describe('getServerNow()', () => {
  it('returns local time when offset is 0', () => {
    const getServerNow = makeGetServerNow(() => 0);
    const now = Date.now();
    const result = getServerNow(now);
    expect(result.getTime()).toBe(now);
  });

  it('returns time in the future when server is ahead', () => {
    const offset = 5000; // server 5 s ahead
    const getServerNow = makeGetServerNow(() => offset);
    const now = 1_000_000;
    const result = getServerNow(now);
    expect(result.getTime()).toBe(now + 5000);
  });

  it('returns time in the past when server is behind', () => {
    const offset = -3000; // server 3 s behind
    const getServerNow = makeGetServerNow(() => offset);
    const now = 1_000_000;
    const result = getServerNow(now);
    expect(result.getTime()).toBe(now - 3000);
  });

  it('advances by 1000 ms between consecutive ticks', () => {
    const offset = 1000;
    const getServerNow = makeGetServerNow(() => offset);
    const t0 = 5_000_000;
    const t1 = t0 + 1000; // 1 second later
    const diff = getServerNow(t1).getTime() - getServerNow(t0).getTime();
    expect(diff).toBe(1000);
  });

  it('reflects an updated offset immediately', () => {
    let offset = 0;
    const getServerNow = makeGetServerNow(() => offset);
    const now = 2_000_000;

    expect(getServerNow(now).getTime()).toBe(now);

    offset = 8000; // re-sync sets new offset
    expect(getServerNow(now).getTime()).toBe(now + 8000);
  });
});

// ---------------------------------------------------------------------------
// 4. End-to-end round-trip scenario
// ---------------------------------------------------------------------------

describe('Full round-trip sync scenario', () => {
  it('client derives accurate server time after one sync exchange', () => {
    // Simulate a real sync with 80 ms RTT and server 30 s ahead
    const SERVER_AHEAD_MS = 30_000;
    const HALF_RTT_MS     = 40;

    const t0         = 1_000_000;
    const serverTime = t0 + HALF_RTT_MS + SERVER_AHEAD_MS; // server captured mid-flight
    const t1         = t0 + HALF_RTT_MS * 2;               // response arrives

    const offset = calcOffset(t0, serverTime, t1);

    // After sync, getServerNow(t1) should equal the server's time at t1
    const expectedServerTimeAtT1 = t1 + SERVER_AHEAD_MS;
    const actualServerTimeAtT1   = t1 + offset;

    expect(actualServerTimeAtT1).toBe(expectedServerTimeAtT1);
  });

  it('server handler + client offset produces consistent result', () => {
    // Wire up the fake socket handler
    const socket = makeFakeSocket();
    registerTimeSyncHandler(socket);

    const t0 = Date.now();
    socket.trigger('time-sync-request', { t0 });
    const t1 = Date.now();

    const response   = socket.emitted[0].data;
    const offset     = calcOffset(response.t0, response.serverTime, t1);

    // Since server and test process share the same clock, offset should be ~0
    expect(Math.abs(offset)).toBeLessThanOrEqual(10); // within 10 ms
  });
});
