import assert from 'node:assert/strict';
import test from 'node:test';
import { honourAddPet } from '../src/twitch/add-pet.ts';
import { honourRemovePet, type SavedPet } from '../src/twitch/remove-pet.ts';
import type { Redemption } from '../src/twitch/connection.ts';

test('a viewer with several pets loses a random one of their own', async () => {
    const { pets, greetings, farm } = farmWith([
        { name: 'First', specie: 'Cat', color: 'Black', twitchUserId: '99' },
        { name: 'Second', specie: 'Dog', color: 'Brown', twitchUserId: '99' },
    ]);
    const logs: string[] = [];

    await honourRemovePet(redemption(), farm, () => 0.99, message => logs.push(message));

    assert.deepEqual(pets, [
        { name: 'First', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);
    assert.deepEqual(greetings, ['Bye Second!']);
    assert.deepEqual(logs, [
        'removing Pet Second (Dog, Brown) for Viewer (viewer)',
        'removed Pet Second (Dog, Brown) for Viewer (viewer)',
    ]);
});

test('another viewer and the farmer keep their pets', async () => {
    const { pets, farm } = farmWith([
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
        { name: 'Mine', specie: 'Turtle', color: 'Green', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption(), farm, () => 0);

    assert.deepEqual(pets, [
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
    ]);
});

test('a viewer with no Pets gets a manual-refund reminder without a goodbye', async () => {
    const existing = [
        { name: 'Barn', specie: 'Cat', color: 'Black' },
        { name: 'Other', specie: 'Dog', color: 'Brown', twitchUserId: '7' },
    ];
    const { pets, greetings, farm } = farmWith(existing);
    const logs: string[] = [];

    await honourRemovePet(redemption(), farm, Math.random, message => logs.push(message));

    assert.deepEqual(pets, existing);
    assert.deepEqual(greetings, []);
    assert.deepEqual(logs, ['remove rejected for Viewer (viewer): Viewer has no Pets; manual refund required in Twitch']);
});

test('a redemption of another reward is left alone', async () => {
    const { pets, greetings, farm } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption({ rewardTitle: 'Добавить кота в IDE' }), farm);

    assert.equal(pets.length, 1);
    assert.deepEqual(greetings, []);
});


test('a Pet that is no longer on the farm is rejected', async () => {
    const { greetings, farm } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);
    farm.remove = () => false;

    await honourRemovePet(redemption(), farm);

    assert.deepEqual(greetings, []);
});

test('what the viewer typed does not choose which pet leaves', async () => {
    const { pets, greetings, farm } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);

    await honourRemovePet(redemption({ userInput: 'dog, brown' }), farm);

    assert.equal(pets.length, 0);
    assert.deepEqual(greetings, ['Bye Mine!']);
});

test('a failed removal save keeps the Pet and has no goodbye', async () => {
    const { pets, greetings, farm } = farmWith([
        { name: 'Mine', specie: 'Cat', color: 'Black', twitchUserId: '99' },
    ]);
    farm.remove = () => { throw new Error('save failed'); };

    await assert.rejects(() => honourRemovePet(redemption(), farm), /save failed/);
    assert.equal(pets[0]?.name, 'Mine');
    assert.deepEqual(greetings, []);
});

test('an unreadable save is reported without a goodbye', async () => {
    const { greetings } = farmWith([]);
    const farm = {
        pets() {
            throw new Error('save unreadable');
        },
        add() {
            throw new Error('should not add');
        },
        remove() {
            return false;
        },
        greet() {
            throw new Error('should not greet');
        },
    };

    await assert.rejects(
        () => honourRemovePet(redemption(), farm),
        /save unreadable/,
    );

    assert.deepEqual(greetings, []);
});

test('a freed slot counts toward the viewer limit immediately', async () => {
    const existing = Array.from({ length: 10 }, (_, index): SavedPet => ({
        name: `Pet${index}`,
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, farm } = farmWith(existing);

    await honourRemovePet(redemption(), farm, () => 0);
    await honourAddPet(redemption({
        rewardTitle: 'Добавить кота в IDE',
        userInput: 'black',
        userName: 'Viewer',
    }), farm, { Cat: ['Black'] });

    assert.equal(pets.length, 10);
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
    return {
        pets,
        greetings,
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
    };
}
