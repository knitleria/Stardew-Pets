import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { SharedJsonFile } from '../src/shared-json-file.ts';

type Save = {
    money: number;
    pets: Array<{ name: string }>;
};

test('a Pet written by the Twitch window appears in another window without reloading', async t => {
    const { filePath, first, second, cleanup } = stores();
    t.after(cleanup);
    const changed = new Promise<Save>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('the visible window did not observe the new Pet')), 500);
        first.onDidChange(next => {
            clearTimeout(timeout);
            resolve(next);
        });
    });

    second.update(save => ({ ...save, pets: [...save.pets, { name: 'Viewer' }] }));

    assert.deepEqual((await changed).pets, [{ name: 'Viewer' }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).pets, [{ name: 'Viewer' }]);
});

test('a stale window cannot erase a Pet while saving another field', t => {
    const { filePath, first, second, cleanup } = stores();
    t.after(cleanup);

    second.update(save => ({ ...save, pets: [...save.pets, { name: 'Viewer' }] }));
    first.update(save => ({ ...save, money: 10 }));

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
        money: 10,
        pets: [{ name: 'Viewer' }],
    });
});

test('a stale write that beats the watcher still announces the new Pet', async t => {
    const { first, second, cleanup } = stores();
    t.after(cleanup);
    const changed = new Promise<Save>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('the racing window did not announce the new Pet')), 500);
        first.onDidChange(next => {
            clearTimeout(timeout);
            resolve(next);
        });
    });

    second.update(save => ({ ...save, pets: [...save.pets, { name: 'Viewer' }] }));
    first.update(save => ({ ...save, money: 10 }));

    assert.deepEqual((await changed).pets, [{ name: 'Viewer' }]);
});

function stores() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stardew-pets-save-'));
    const filePath = path.join(directory, 'save.json');
    fs.writeFileSync(filePath, JSON.stringify({ money: 0, pets: [] }));
    const create = () => new SharedJsonFile<Save>(filePath, JSON.parse, JSON.stringify, { watchIntervalMs: 20 });
    const first = create();
    const second = create();
    return {
        filePath,
        first,
        second,
        cleanup() {
            first.dispose();
            second.dispose();
            fs.rmSync(directory, { recursive: true, force: true });
        },
    };
}
