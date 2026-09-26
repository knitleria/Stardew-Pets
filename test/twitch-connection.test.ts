import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTwitchConnection, twitchTokenKey } from '../src/twitch/connection.ts';

test('connect command without a saved token shows the device code and stores the granted tokens', async () => {
    const secrets = memorySecrets();
    const codes: Array<{ code: string; uri: string }> = [];
    const deviceRequests: Array<{ clientId: string; scopes: readonly string[] }> = [];
    const polls: Array<{ clientId: string; deviceCode: string }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode(code, uri) {
                codes.push({ code, uri });
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode(clientId, scopes) {
                deviceRequests.push({ clientId, scopes });
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode(clientId, deviceCode) {
                polls.push({ clientId, deviceCode });
                return {
                    status: 'approved',
                    tokens: {
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        expiresInSeconds: 14_400,
                    },
                };
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('command');

    assert.deepEqual(codes, [{ code: 'ABCD-EFGH', uri: 'https://www.twitch.tv/activate' }]);
    assert.deepEqual(deviceRequests, [{ clientId: 'client-id', scopes: ['channel:manage:redemptions'] }]);
    assert.deepEqual(polls, [{ clientId: 'client-id', deviceCode: 'device-code' }]);
    assert.deepEqual(secrets.stored(), [{
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }]);
});

test('connect keeps polling until Twitch approves the device code', async () => {
    const secrets = memorySecrets();
    const waits: number[] = [];
    let polls = 0;
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                return undefined;
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            async wait(ms) {
                waits.push(ms);
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                polls += 1;
                if (polls === 1) {
                    return { status: 'pending' as const };
                }
                return {
                    status: 'approved' as const,
                    tokens: {
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        expiresInSeconds: 14_400,
                    },
                };
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('command');

    assert.deepEqual(waits, [5000, 14_340_000]);
    assert.equal(polls, 2);
    assert.deepEqual(secrets.stored(), [{
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }]);
});

test('a slow-down reply waits longer before the next poll', async () => {
    const waits: number[] = [];
    const replies = ['pending', 'slow-down', 'approved'] as const;
    let polls = 0;
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets: memorySecrets(),
        notify: {
            showCode() {
                return undefined;
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            async wait(ms) {
                waits.push(ms);
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                const status = replies[polls];
                polls += 1;
                if (status === 'approved') {
                    return {
                        status: 'approved' as const,
                        tokens: {
                            accessToken: 'access-token',
                            refreshToken: 'refresh-token',
                            expiresInSeconds: 14_400,
                        },
                    };
                }
                return { status };
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('command');

    assert.deepEqual(waits, [5000, 10_000, 14_340_000]);
});

test('a denied device code is an error and stores nothing', async () => {
    const secrets = memorySecrets();
    const errors: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                return undefined;
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: { now: () => 0, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                return { status: 'denied' as const };
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('command');

    assert.deepEqual(errors, ['Twitch authorization was denied.']);
    assert.deepEqual(secrets.stored(), []);
});

test('an expired device code is an error and stores nothing', async () => {
    const secrets = memorySecrets();
    const errors: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                return undefined;
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: { now: () => 0, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                return { status: 'expired' as const };
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('command');

    assert.deepEqual(errors, ['The Twitch code expired. Run Connect again.']);
    assert.deepEqual(secrets.stored(), []);
});

test('startup without a saved token leaves Twitch alone', async () => {
    let twitchCalls = 0;
    const codes: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets: memorySecrets(),
        notify: {
            showCode(code) {
                codes.push(code);
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 0, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                twitchCalls += 1;
                throw new Error('no device code on startup');
            },
            async pollDeviceCode() {
                twitchCalls += 1;
                throw new Error('no poll on startup');
            },
        },
        openSocket() {
            twitchCalls += 1;
            throw new Error('no socket on startup');
        },
    });

    await connection.connect('startup');

    assert.equal(twitchCalls, 0);
    assert.deepEqual(codes, []);
});

test('only the window that took the lock talks to Twitch', async () => {
    const lockDir = tempLockDir();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = createTwitchConnection(signInDependencies(lockDir, () => {
        firstCalls += 1;
    }));
    const second = createTwitchConnection(signInDependencies(lockDir, () => {
        secondCalls += 1;
    }));

    await first.connect('startup');
    await second.connect('command');
    await first.connect('command');

    assert.equal(secondCalls, 0);
    assert.equal(firstCalls, 1);
});

test('a lock left by a dead window can be taken', async () => {
    const lockDir = tempLockDir();
    const finished = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(typeof finished.pid, 'number');
    writeFileSync(join(lockDir, 'twitch.lock'), String(finished.pid));
    let calls = 0;
    const connection = createTwitchConnection(signInDependencies(lockDir, () => {
        calls += 1;
    }));

    await connection.connect('command');

    assert.equal(calls, 1);
});

test('closing the window releases the lock', async () => {
    const lockDir = tempLockDir();
    let secondCalls = 0;
    const first = createTwitchConnection(signInDependencies(lockDir, () => undefined));
    const second = createTwitchConnection(signInDependencies(lockDir, () => {
        secondCalls += 1;
    }));

    await first.connect('startup');
    first.dispose();
    await second.connect('command');

    assert.equal(secondCalls, 1);
});

test('a saved token opens one EventSub socket and subscribes to stream online and offline', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const subscriptions: Array<{ type: string; sessionId: string; broadcasterUserId: string; accessToken: string }> = [];
    const liveChecks: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser(_clientId, accessToken) {
                assert.equal(accessToken, 'access-token');
                return { id: '42' };
            },
            async isStreamLive(_clientId, accessToken, userId) {
                liveChecks.push(`${accessToken} ${userId}`);
                return false;
            },
            async subscribe(input) {
                subscriptions.push({
                    type: input.type,
                    sessionId: input.sessionId,
                    broadcasterUserId: input.broadcasterUserId,
                    accessToken: input.accessToken,
                });
                return { id: `sub-${subscriptions.length}` };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    assert.equal(sockets.length, 1);
    sockets[0].receive(sessionWelcome('session-1'));
    await new Promise(resolve => {
        setImmediate(resolve);
    });

    assert.equal(sockets[0].url, 'wss://eventsub.wss.twitch.tv/ws');
    assert.deepEqual(liveChecks, ['access-token 42']);
    assert.deepEqual(subscriptions, [
        { type: 'stream.online', sessionId: 'session-1', broadcasterUserId: '42', accessToken: 'access-token' },
        { type: 'stream.offline', sessionId: 'session-1', broadcasterUserId: '42', accessToken: 'access-token' },
    ]);
});

test('a live channel also subscribes to reward redemptions', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const types: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return true;
            },
            async subscribe(input) {
                types.push(input.type);
                return { id: `sub-${types.length}` };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    sockets[0].receive(sessionWelcome('session-1'));
    await new Promise(resolve => {
        setImmediate(resolve);
    });

    assert.deepEqual(types, [
        'stream.online',
        'stream.offline',
        'channel.channel_points_custom_reward_redemption.add',
    ]);
});

test('stream.online while offline subscribes to redemptions and reports the event', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const types: string[] = [];
    const events: Array<{ type: string }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe(input) {
                types.push(input.type);
                return { id: `sub-${types.length}` };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });
    connection.onEvent(event => {
        events.push({ type: event.type });
    });

    await connection.connect('startup');
    sockets[0].receive(sessionWelcome('session-1'));
    await flush();
    sockets[0].receive(notification('msg-online', 'stream.online'));
    await flush();

    assert.deepEqual(events, [{ type: 'stream.online' }]);
    assert.deepEqual(types, [
        'stream.online',
        'stream.offline',
        'channel.channel_points_custom_reward_redemption.add',
    ]);
});

test('stream.offline removes the redemption subscription and reports the event', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const removed: string[] = [];
    const events: Array<{ type: string }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return true;
            },
            async subscribe(input) {
                return {
                    id: input.type === 'channel.channel_points_custom_reward_redemption.add' ? 'redemption-sub' : 'status-sub',
                };
            },
            async unsubscribe(input) {
                removed.push(`${input.accessToken} ${input.id}`);
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });
    connection.onEvent(event => {
        events.push({ type: event.type });
    });

    await connection.connect('startup');
    sockets[0].receive(sessionWelcome('session-1'));
    await flush();
    sockets[0].receive(notification('msg-offline', 'stream.offline'));
    await flush();

    assert.deepEqual(events, [{ type: 'stream.offline' }]);
    assert.deepEqual(removed, ['access-token redemption-sub']);
});

test('a redemption notification is reported once per message id', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const events: Array<{ type: string; redemption?: { userName: string; userInput: string; rewardTitle: string; id: string } }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return true;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });
    connection.onEvent(event => {
        if (event.type !== 'redemption') {
            return;
        }
        events.push({
            type: event.type,
            redemption: {
                id: event.redemption.id,
                userName: event.redemption.userName,
                userInput: event.redemption.userInput,
                rewardTitle: event.redemption.rewardTitle,
            },
        });
    });

    await connection.connect('startup');
    sockets[0].receive(sessionWelcome('session-1'));
    await flush();
    sockets[0].receive(redemptionNotification('msg-1', 'redemption-1'));
    sockets[0].receive(redemptionNotification('msg-1', 'redemption-1'));
    sockets[0].receive(redemptionNotification('msg-2', 'redemption-2'));
    await flush();

    assert.deepEqual(events, [
        { type: 'redemption', redemption: { id: 'redemption-1', userName: 'Viewer', userInput: 'Cat, Black', rewardTitle: 'Add a pet' } },
        { type: 'redemption', redemption: { id: 'redemption-2', userName: 'Viewer', userInput: 'Cat, Black', rewardTitle: 'Add a pet' } },
    ]);
});

test('disconnect closes the socket and keeps the saved token', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    await connection.disconnect();

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].closed, true);
    assert.equal(secrets.stored().length, 1);
});

test('an access token near expiry is refreshed and the saved refresh token is replaced', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        expiresAt: 1_700_000_030_000,
    }));
    const refreshed: string[] = [];
    const usedAccess: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async refresh(_clientId, refreshToken) {
                refreshed.push(refreshToken);
                return {
                    accessToken: 'access-new',
                    refreshToken: 'refresh-new',
                    expiresInSeconds: 14_400,
                };
            },
            async currentUser(_clientId, accessToken) {
                usedAccess.push(accessToken);
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('startup');

    assert.deepEqual(refreshed, ['refresh-old']);
    assert.deepEqual(usedAccess, ['access-new']);
    assert.deepEqual(secrets.stored(), [{
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: 1_700_014_400_000,
    }]);
});

test('a fresh access token is refreshed one minute before it expires', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        expiresAt: 1_700_014_400_000,
    }));
    const waits: number[] = [];
    let release = () => undefined;
    let now = 1_700_000_000_000;
    const refreshed: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: {
            now: () => now,
            wait(ms) {
                waits.push(ms);
                return new Promise<void>(resolve => {
                    release = () => {
                        now += ms;
                        resolve();
                    };
                });
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async refresh(_clientId, refreshToken) {
                refreshed.push(refreshToken);
                return {
                    accessToken: 'access-new',
                    refreshToken: 'refresh-new',
                    expiresInSeconds: 14_400,
                };
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('startup');

    assert.deepEqual(waits, [14_340_000]);
    assert.deepEqual(refreshed, []);
    release();
    await flush();

    assert.deepEqual(refreshed, ['refresh-old']);
    assert.deepEqual(secrets.stored(), [{
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: 1_700_028_740_000,
    }]);
});

test('a silent refresh is what a later reconnect uses', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const usedAccess: string[] = [];
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    let now = 1_700_000_000_000;
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError() {
                return undefined;
            },
        },
        clock: {
            now: () => now,
            wait(ms) {
                return new Promise<void>(resolve => {
                    waits.push({
                        ms,
                        resolve: () => {
                            now += ms;
                            resolve();
                        },
                    });
                });
            },
        },
        twitch: {
            ...quietSession(),
            async refresh() {
                return {
                    accessToken: 'access-new',
                    refreshToken: 'refresh-new',
                    expiresInSeconds: 14_400,
                };
            },
            async currentUser(_clientId, accessToken) {
                usedAccess.push(accessToken);
                return { id: '42' };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    waits[0].resolve();
    await flush();
    sockets[0].drop();
    waits[waits.length - 1].resolve();
    await flush();

    assert.deepEqual(usedAccess, ['access-old', 'access-new']);
});

test('a rejected refresh asks the farmer for a new code', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-old',
        refreshToken: 'refresh-dead',
        expiresAt: 1_700_000_000_000,
    }));
    const codes: Array<{ code: string; uri: string }> = [];
    const usedAccess: string[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode(code, uri) {
                codes.push({ code, uri });
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'WXYZ-9876',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                return {
                    status: 'approved' as const,
                    tokens: {
                        accessToken: 'access-new',
                        refreshToken: 'refresh-new',
                        expiresInSeconds: 14_400,
                    },
                };
            },
            async refresh() {
                return { rejected: true as const };
            },
            async currentUser(_clientId, accessToken) {
                usedAccess.push(accessToken);
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            return new FakeSocket(url);
        },
    });

    await connection.connect('startup');

    assert.deepEqual(codes, [{ code: 'WXYZ-9876', uri: 'https://www.twitch.tv/activate' }]);
    assert.deepEqual(usedAccess, ['access-new']);
    assert.deepEqual(secrets.stored(), [{
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: 1_700_014_400_000,
    }]);
});

test('a dropped socket reconnects after 1s, 2s, 4s, 8s, 16s, 32s, then a minute', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError() {
                return undefined;
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait(ms) {
                return new Promise<void>(resolve => {
                    waits.push({ ms, resolve });
                });
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async refresh() {
                throw new Error('unexpected refresh');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    assert.deepEqual(waits.map(wait => wait.ms), [14_340_000]);

    const pauses = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000];
    for (const pause of pauses) {
        const before = sockets.length;
        sockets[sockets.length - 1].drop();
        assert.equal(waits[waits.length - 1].ms, pause);
        waits[waits.length - 1].resolve();
        await flush();
        assert.equal(sockets.length, before + 1);
    }
});

test('session_reconnect moves to the new socket without subscribing again', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const waits: number[] = [];
    let subscriptions = 0;
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError() {
                return undefined;
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait(ms) {
                waits.push(ms);
                return new Promise<void>(() => undefined);
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async refresh() {
                throw new Error('unexpected refresh');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                subscriptions += 1;
                return { id: `sub-${subscriptions}` };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    sockets[0].receive(sessionWelcome('session-1'));
    await flush();
    const subscribed = subscriptions;
    sockets[0].receive(sessionReconnect('wss://eventsub.wss.twitch.tv/ws?reconnect=abc'));
    await flush();
    sockets[1].receive(sessionWelcome('session-1'));
    await flush();
    sockets[0].drop();
    await flush();

    assert.equal(sockets[1].url, 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc');
    assert.equal(subscriptions, subscribed);
    assert.equal(sockets.length, 2);
    assert.deepEqual(waits, [14_340_000]);
});

test('a dropped connection is announced once until Twitch welcomes again', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const errors: string[] = [];
    const waits: Array<{ resolve: () => void }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait() {
                return new Promise<void>(resolve => {
                    waits.push({ resolve });
                });
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                throw new Error('unexpected device code');
            },
            async pollDeviceCode() {
                throw new Error('unexpected poll');
            },
            async refresh() {
                throw new Error('unexpected refresh');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    sockets[0].drop();
    assert.deepEqual(errors, ['Twitch connection lost. Reconnecting.']);
    waits[waits.length - 1].resolve();
    await flush();
    sockets[1].receive(sessionWelcome('session-2'));
    await flush();
    sockets[1].drop();

    assert.deepEqual(errors, [
        'Twitch connection lost. Reconnecting.',
        'Twitch connection lost. Reconnecting.',
    ]);
});

test('the connect command opens the socket after the code is approved', async () => {
    const sockets: FakeSocket[] = [];
    const waits: number[] = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets: memorySecrets(),
        notify: {
            showCode() {
                return undefined;
            },
            showError(message) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait(ms) {
                waits.push(ms);
                return new Promise<void>(() => undefined);
            },
        },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                return {
                    status: 'approved' as const,
                    tokens: {
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        expiresInSeconds: 14_400,
                    },
                };
            },
            async refresh() {
                throw new Error('unexpected refresh');
            },
            async currentUser() {
                return { id: '42' };
            },
            async isStreamLive() {
                return false;
            },
            async subscribe() {
                return { id: 'sub' };
            },
            async unsubscribe() {
                return undefined;
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('command');
    await connection.connect('command');

    assert.deepEqual(sockets.map(socket => socket.url), ['wss://eventsub.wss.twitch.tv/ws']);
    assert.deepEqual(waits, [14_340_000]);
});

test('connect without a client id reports an error and does not call Twitch', async () => {
    let calls = 0;
    const errors: string[] = [];
    const connection = createTwitchConnection({
        clientId: '',
        lockDir: tempLockDir(),
        secrets: memorySecrets(),
        notify: {
            showCode() {
                calls += 1;
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: { now: () => 0, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                calls += 1;
                throw new Error('twitch');
            },
            async pollDeviceCode() {
                calls += 1;
                throw new Error('twitch');
            },
            async refresh() {
                calls += 1;
                throw new Error('twitch');
            },
            async currentUser() {
                calls += 1;
                throw new Error('twitch');
            },
            async isStreamLive() {
                calls += 1;
                return false;
            },
            async subscribe() {
                calls += 1;
                return { id: 'sub' };
            },
            async unsubscribe() {
                calls += 1;
            },
        },
        openSocket(_url: string) {
            calls += 1;
            throw new Error('socket');
        },
    });

    await connection.connect('command');

    assert.equal(calls, 0);
    assert.deepEqual(errors, ['Set stardew-pets.twitch.clientId to a Twitch application client ID.']);
});

test('a socket error is shown once and the connection retries', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const errors: string[] = [];
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait(ms) {
                return new Promise<void>(resolve => {
                    waits.push({ ms, resolve });
                });
            },
        },
        twitch: {
            ...quietSession(),
            async currentUser() {
                return { id: '42' };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    sockets[0].fail(new Error('socket reset'));
    waits[waits.length - 1].resolve();
    await flush();

    assert.deepEqual(errors, ['socket reset']);
    assert.equal(sockets.length, 2);
});

test('a failed startup retries on the reconnect schedule', async () => {
    const secrets = memorySecrets();
    await secrets.store(twitchTokenKey, JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 1_700_014_400_000,
    }));
    const sockets: FakeSocket[] = [];
    const errors: string[] = [];
    const waits: Array<{ ms: number; resolve: () => void }> = [];
    let attempts = 0;
    const connection = createTwitchConnection({
        clientId: 'client-id',
        lockDir: tempLockDir(),
        secrets,
        notify: {
            showCode() {
                throw new Error('unexpected code');
            },
            showError(message) {
                errors.push(message);
            },
        },
        clock: {
            now: () => 1_700_000_000_000,
            wait(ms) {
                return new Promise<void>(resolve => {
                    waits.push({ ms, resolve });
                });
            },
        },
        twitch: {
            ...quietSession(),
            async currentUser() {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('Helix is down');
                }
                return { id: '42' };
            },
        },
        openSocket(url) {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
    });

    await connection.connect('startup');
    assert.deepEqual(errors, ['Helix is down']);
    assert.equal(waits[waits.length - 1].ms, 1000);
    waits[waits.length - 1].resolve();
    await flush();

    assert.equal(sockets.length, 1);
    assert.deepEqual(errors, ['Helix is down']);
});

function signInDependencies(lockDir: string, onDeviceCode: () => void) {
    return {
        clientId: 'client-id',
        lockDir,
        secrets: memorySecrets(),
        notify: {
            showCode() {
                return undefined;
            },
            showError(message: string) {
                throw new Error(`unexpected error: ${message}`);
            },
        },
        clock: { now: () => 1_700_000_000_000, wait: () => new Promise<void>(() => undefined) },
        twitch: {
            ...quietSession(),
            async requestDeviceCode() {
                onDeviceCode();
                return {
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://www.twitch.tv/activate',
                    intervalSeconds: 5,
                    expiresInSeconds: 1800,
                };
            },
            async pollDeviceCode() {
                return {
                    status: 'approved' as const,
                    tokens: {
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        expiresInSeconds: 14_400,
                    },
                };
            },
        },
        openSocket(url: string) {
            return new FakeSocket(url);
        },
    };
}

function quietSession() {
    return {
        async requestDeviceCode(): Promise<never> {
            throw new Error('unexpected device code');
        },
        async pollDeviceCode(): Promise<never> {
            throw new Error('unexpected poll');
        },
        async refresh(): Promise<never> {
            throw new Error('unexpected refresh');
        },
        async currentUser() {
            return { id: '42' };
        },
        async isStreamLive() {
            return false;
        },
        async subscribe() {
            return { id: 'sub' };
        },
        async unsubscribe() {
            return undefined;
        },
    };
}

class FakeSocket {
    readonly url: string;
    private messageHandler: ((data: string) => void) | undefined;

    constructor(url: string) {
        this.url = url;
    }

    closed = false;

    close() {
        this.closed = true;
        this.closeHandler?.();
    }

    onMessage(handler: (data: string) => void) {
        this.messageHandler = handler;
    }

    private closeHandler: (() => void) | undefined;

    onClose(handler: () => void) {
        this.closeHandler = handler;
    }

    drop() {
        this.closeHandler?.();
    }

    private errorHandler: ((error: Error) => void) | undefined;

    onError(handler: (error: Error) => void) {
        this.errorHandler = handler;
    }

    fail(error: Error) {
        this.errorHandler?.(error);
    }

    receive(message: unknown) {
        this.messageHandler?.(JSON.stringify(message));
    }
}

function redemptionNotification(messageId: string, redemptionId: string) {
    return {
        metadata: {
            message_id: messageId,
            message_type: 'notification',
            message_timestamp: '2026-09-26T12:06:00.000Z',
            subscription_type: 'channel.channel_points_custom_reward_redemption.add',
            subscription_version: '1',
        },
        payload: {
            subscription: {
                id: 'redemption-sub',
                type: 'channel.channel_points_custom_reward_redemption.add',
                version: '1',
            },
            event: {
                id: redemptionId,
                broadcaster_user_id: '42',
                user_id: '99',
                user_login: 'viewer',
                user_name: 'Viewer',
                user_input: 'Cat, Black',
                reward: {
                    id: 'reward-1',
                    title: 'Add a pet',
                    cost: 1000,
                    prompt: '',
                },
            },
        },
    };
}

function notification(messageId: string, subscriptionType: string) {
    return {
        metadata: {
            message_id: messageId,
            message_type: 'notification',
            message_timestamp: '2026-09-26T12:05:00.000Z',
            subscription_type: subscriptionType,
            subscription_version: '1',
        },
        payload: {
            subscription: { id: 'sub', type: subscriptionType, version: '1' },
            event: { broadcaster_user_id: '42' },
        },
    };
}

function flush() {
    return new Promise<void>(resolve => {
        setImmediate(resolve);
    });
}

function sessionReconnect(url: string) {
    return {
        metadata: {
            message_id: 'reconnect-1',
            message_type: 'session_reconnect',
            message_timestamp: '2026-09-26T12:10:00.000Z',
        },
        payload: {
            session: {
                id: 'session-1',
                status: 'reconnecting',
                keepalive_timeout_seconds: 10,
                reconnect_url: url,
                connected_at: '2026-09-26T12:00:00.000Z',
            },
        },
    };
}

function sessionWelcome(sessionId: string) {
    return {
        metadata: {
            message_id: `welcome-${sessionId}`,
            message_type: 'session_welcome',
            message_timestamp: '2026-09-26T12:00:00.000Z',
        },
        payload: {
            session: {
                id: sessionId,
                status: 'connected',
                keepalive_timeout_seconds: 10,
                reconnect_url: null,
                connected_at: '2026-09-26T12:00:00.000Z',
            },
        },
    };
}

function tempLockDir(): string {
    return mkdtempSync(join(tmpdir(), 'stardew-twitch-'));
}

function memorySecrets() {
    const values = new Map<string, string>();
    return {
        async get(key: string) {
            return values.get(key);
        },
        async store(key: string, value: string) {
            values.set(key, value);
        },
        async delete(key: string) {
            values.delete(key);
        },
        stored() {
            return [...values.values()].map(value => JSON.parse(value) as unknown);
        },
    };
}
