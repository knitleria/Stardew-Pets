import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as vm from 'node:vm';
import { buildSync } from 'esbuild';
import type { Farm, SavedPet } from '../src/twitch/add-pet.ts';

const nodeRequire = createRequire(path.resolve('test/twitch-redemption.test.ts'));
const startup = buildSync({
    entryPoints: [path.resolve('src/twitch/start.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['vscode'],
}).outputFiles[0].text;

test('manual Rewards add and remove Pets offline without confirming or refunding through Twitch', async t => {
    const pets: SavedPet[] = [];
    const greetings: string[] = [];
    const lines: string[] = [];
    const errors: string[] = [];
    const requests: string[] = [];
    const sockets: FakeSocket[] = [];
    const subscriptions: Array<{ dispose(): void }> = [];
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardew-manual-rewards-'));
    t.after(() => {
        for (const subscription of subscriptions) subscription.dispose();
        fs.rmSync(lockDir, { recursive: true, force: true });
    });
    class FakeSocket {
        handlers = new Map<string, (event: { data: string }) => void>();
        constructor() { sockets.push(this); }
        addEventListener(type: string, handler: (event: { data: string }) => void) { this.handlers.set(type, handler); }
        close() {}
        receive(message: unknown) { this.handlers.get('message')!({ data: JSON.stringify(message) }); }
    }
    const vscode = {
        workspace: { getConfiguration: () => ({ get: () => 'client-id' }) },
        window: {
            createOutputChannel: () => ({ appendLine: (line: string) => lines.push(line), show() {}, dispose() {} }),
            showErrorMessage: (message: string) => errors.push(message),
        },
        commands: { registerCommand: () => ({ dispose() {} }) },
    };
    const module = { exports: { startTwitch: (_context: unknown, _lockDir: string, _farm: Farm) => {} } };
    vm.runInNewContext(startup, {
        module,
        require: (name: string) => name === 'vscode' ? vscode : nodeRequire(name),
        process,
        Error,
        console: { log() {}, error() {} },
        setTimeout: () => 0,
        clearTimeout() {},
        WebSocket: FakeSocket,
        fetch: async (url: string, input: { method: string }) => {
            requests.push(input.method);
            if (input.method === 'PATCH') {
                return response(403, { message: 'The ID in the Client-Id header must match the client ID used to create the custom reward, or the broadcaster doesn\'t have partner or affiliate status.' });
            }
            if (url.includes('/users')) return response(200, { data: [{ id: '42' }] });
            if (url.includes('/channel_points/custom_rewards')) return response(200, { data: [] });
            if (url.includes('/eventsub/subscriptions')) return response(202, { data: [{ id: 'subscription-1' }] });
            throw new Error('unexpected Twitch request');
        },
    });
    const farm: Farm = {
        pets: () => pets,
        add: pet => { pets.push(pet); },
        remove(pet) {
            const index = pets.indexOf(pet);
            if (index < 0) return false;
            pets.splice(index, 1);
            return true;
        },
        greet: message => { greetings.push(message); },
    };
    module.exports.startTwitch({
        subscriptions,
        secrets: {
            get: async () => JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 14_400_000 }),
            store: async () => {},
            delete: async () => {},
        },
    }, lockDir, farm);
    await flush();
    assert.equal(sockets.length, 1);
    sockets[0].receive({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1' } } });
    await flush();

    await redeem('sheep-1', 'Добавить овечку в IDE', 'Adult');
    assert.deepEqual(pets.map(pet => [pet.name, pet.specie, pet.color, pet.twitchUserId]), [['Viewer', 'Sheep', 'Adult', '99']]);
    await redeem('sheep-1', 'Добавить овечку в IDE', 'Adult');
    assert.equal(pets.length, 1);

    await redeem('invalid-1', 'Добавить овечку в IDE', 'plaid');
    assert.equal(pets.length, 1);
    assert.ok(lines.some(line => line.includes('invalid Pet choice') && line.includes('manual refund')));
    await redeem('other-1', 'Unrelated Reward', '');
    assert.equal(pets.length, 1);
    await redeem('remove-1', 'Удалить питомца из IDE', '');
    assert.equal(pets.length, 0);
    await redeem('remove-2', 'Удалить питомца из IDE', '');
    assert.ok(lines.some(line => line.includes('Viewer has no Pets') && line.includes('manual refund')));
    assert.deepEqual(greetings, ['Say hi to Viewer!', 'Bye Viewer!']);
    assert.equal(errors.length, 0);
    assert.deepEqual(requests, ['GET', 'GET', 'POST']);

    farm.add = () => { throw new Error('save failed'); };
    await redeem('sheep-2', 'Добавить овечку в IDE', 'Adult');
    assert.equal(pets.length, 0);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('save failed') && errors[0].includes('manual refund'));
    assert.deepEqual(requests, ['GET', 'GET', 'POST']);

    async function redeem(id: string, title: string, input: string) {
        sockets[0].receive({
            metadata: { message_id: `msg-${id}`, message_type: 'notification', subscription_type: 'channel.channel_points_custom_reward_redemption.add' },
            payload: { event: {
                id, broadcaster_user_id: '42', user_id: '99', user_login: 'viewer', user_name: 'Viewer',
                user_input: input, reward: { id: `reward-${title}`, title },
            } },
        });
        await flush();
    }
});

function response(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function flush() {
    for (let index = 0; index < 12; index++) await new Promise<void>(resolve => setImmediate(resolve));
}
