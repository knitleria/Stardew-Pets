import assert from 'node:assert/strict';
import test from 'node:test';
import { honourAddPet } from '../src/twitch/add-pet.ts';
import { honourRemovePet, type SavedPet } from '../src/twitch/remove-pet.ts';
import type { Redemption } from '../src/twitch/connection.ts';

test('a viewer with several pets loses a random one of their own', async () => {
    const { pets, greetings, settled, farm, desk } = farmWith([
        { name: 'First', specie: 'Cat', color: 'Black', twitchUserId: '99' },
        { name: 'Second', specie: 'Dog', color: 'Brown', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption(), farm, desk, () => 0.99);

    assert.deepEqual(pets, [
        { name: 'First', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);
    assert.deepEqual(greetings, ['Bye Second!']);
    assert.deepEqual(settled, ['FULFILLED']);
});

test('another viewer and the farmer keep their pets', async () => {
    const { pets, farm, desk } = farmWith([
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
        { name: 'Mine', specie: 'Turtle', color: 'Green', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption(), farm, desk, () => 0);

    assert.deepEqual(pets, [
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
    ]);
});

test('a viewer with no pets of their own is refunded without a goodbye', async () => {
    const existing = [
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
    ];
    const { pets, greetings, settled, farm, desk } = farmWith(existing);

    await honourRemovePet(redemption(), farm, desk);

    assert.deepEqual(pets, existing);
    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, ['CANCELED']);
});

test('a redemption of another reward is left alone', async () => {
    const { pets, greetings, settled, farm, desk } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption({ rewardTitle: 'Добавить питомца в IDE' }), farm, desk);

    assert.equal(pets.length, 1);
    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, []);
});

test('a pet stays when Twitch refuses to fulfill the removal', async () => {
    const { pets, greetings, farm } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);

    await assert.rejects(
        () => honourRemovePet(redemption(), farm, {
            async settle() {
                throw new Error('Twitch request failed (403).');
            },
        }),
        /403/,
    );

    assert.equal(pets[0]?.name, 'Mine');
    assert.deepEqual(greetings, []);
});

test('a pet that is no longer on the farm is refunded', async () => {
    const { greetings, settled, farm, desk } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);
    farm.remove = () => false;

    await honourRemovePet(redemption(), farm, desk);

    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, ['CANCELED']);
});

test('what the viewer typed does not choose which pet leaves', async () => {
    const { pets, greetings, farm, desk } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption({ userInput: 'dog, brown' }), farm, desk);

    assert.equal(pets.length, 0);
    assert.deepEqual(greetings, ['Bye Mine!']);
});

test('a freed slot counts toward the viewer limit immediately', async () => {
    const existing = Array.from({ length: 10 }, (_, index): SavedPet => ({
        name: `Pet${index}`,
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, settled, farm, desk } = farmWith(existing);

    await honourRemovePet(redemption(), farm, desk, () => 0);
    await honourAddPet(redemption({
        rewardTitle: 'Добавить питомца в IDE',
        userInput: 'cat, black',
        userName: 'Viewer',
    }), farm, desk, { Cat: ['Black'] });

    assert.equal(pets.length, 10);
    assert.equal(settled.at(-1), 'FULFILLED');
});

function redemption(overrides: Partial<Redemption> = {}): Redemption {
    return {
        id: 'redemption-1',
        broadcasterUserId: '42',
        userId: '99',
        userLogin: 'viewer',
        userName: 'Viewer',
        userInput: '',
        rewardId: 'remove-id',
        rewardTitle: 'Удалить питомца из IDE',
        ...overrides,
    };
}

function farmWith(pets: SavedPet[]) {
    const greetings: string[] = [];
    const settled: Array<'FULFILLED' | 'CANCELED'> = [];
    return {
        pets,
        greetings,
        settled,
        farm: {
            pets() {
                return pets;
            },
            add(pet: SavedPet) {
                pets.push(pet);
            },
            remove(pet: SavedPet) {
                const index = pets.indexOf(pet);
                if (index < 0) {
                    return false;
                }
                pets.splice(index, 1);
                return true;
            },
            greet(text: string) {
                greetings.push(text);
            },
        },
        desk: {
            async settle(status: 'FULFILLED' | 'CANCELED') {
                settled.push(status);
            },
        },
    };
}
