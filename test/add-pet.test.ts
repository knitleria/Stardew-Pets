import assert from 'node:assert/strict';
import test from 'node:test';
import { petSpecies } from '../src/pets/catalog.ts';
import { honourAddPet, type SavedPet } from '../src/twitch/add-pet.ts';
import type { Redemption } from '../src/twitch/connection.ts';

const species = {
    Cat: ['Black', 'Gray'],
    Dog: ['Brown', 'Dark Brown'],
    Chicken: ['White Adult', 'Brown Baby'],
    Dino: [],
};

test('a cat Reward adds a cat named with the viewer display name', async () => {
    const { pets, greetings, farm } = farmWith();
    const logs: string[] = [];

    await honourAddPet(redemption({ userInput: 'black' }), farm, species, Math.random, message => logs.push(message));

    assert.deepEqual(pets, [{
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }]);
    assert.deepEqual(greetings, ['Say hi to Viewer!']);
    assert.deepEqual(logs, [
        'adding Pet Viewer (Cat, Black) for Viewer (viewer)',
        'added Pet Viewer (Cat, Black) for Viewer (viewer)',
    ]);
});

test('a viewer who copies the prompt literally still gets the pet', async () => {
    const copied = farmWith();
    await honourAddPet(redemption({ userInput: '{Black}' }), copied.farm, species);
    assert.deepEqual(copied.pets, [{
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }]);

    const quoted = farmWith();
    await honourAddPet(redemption({ userInput: '"black"' }), quoted.farm, species);
    assert.equal(quoted.pets[0]?.color, 'Black');
});

test('a two-word variant is kept whole', async () => {
    const { pets, farm } = farmWith();

    await honourAddPet(redemption({ rewardTitle: 'Добавить курицу в IDE', userInput: ' [ WHITE   ADULT ] ' }), farm, species);

    assert.equal(pets[0]?.specie, 'Chicken');
    assert.equal(pets[0]?.color, 'White Adult');
});

test('empty text and random choose a variant from the Reward specie', async () => {
    for (const userInput of ['', ' \t\n ', '{}', 'random', 'RaNdOm', ' « RANDOM » ']) {
        for (const [value, color] of [[0, 'Black'], [0.99, 'Gray']] satisfies Array<[number, string]>) {
            const { pets, farm } = farmWith();
            await honourAddPet(redemption({ userInput }), farm, species, () => value);
            assert.equal(pets[0]?.specie, 'Cat');
            assert.equal(pets[0]?.color, color);
        }
    }
});

test('an invalid Variant is rejected with a manual-refund reminder', async () => {
    const invalid = farmWith();
    const logs: string[] = [];
    await honourAddPet(redemption({ userInput: 'cat black' }), invalid.farm, species, Math.random, message => logs.push(message));
    assert.deepEqual(invalid.pets, []);
    assert.deepEqual(invalid.greetings, []);
    assert.deepEqual(logs, ['add rejected for Viewer (viewer): invalid Pet choice "cat black"; manual refund required in Twitch']);

    for (const userInput of ['cat, black', 'plaid', 'Green', 'White Adult']) {
        const world = farmWith();
        await honourAddPet(redemption({ userInput }), world.farm, species);
        assert.deepEqual(world.pets, []);
        assert.deepEqual(world.greetings, []);
    }
});

test('a display name the nameplate font cannot draw is replaced by the login', async () => {
    const { pets, greetings, farm } = farmWith();

    await honourAddPet(redemption({
        userName: 'Валерия',
        userLogin: 'valeria',
        userInput: 'black',
    }), farm, species);

    assert.equal(pets[0]?.name, 'valeria');
    assert.deepEqual(greetings, ['Say hi to valeria!']);
});

test('a display name is kept when only its accents sit outside the font', async () => {
    const { pets, farm } = farmWith();

    await honourAddPet(redemption({
        userName: 'José',
        userLogin: 'jose',
        userInput: 'black',
    }), farm, species);

    assert.equal(pets[0]?.name, 'José');
});

test('a display name longer than the nameplate is stored whole', async () => {
    const { pets, farm } = farmWith();

    await honourAddPet(redemption({ userName: 'LongDisplayName', userInput: 'black' }), farm, species);

    assert.equal(pets[0]?.name, 'LongDisplayName');
});

test('the viewer limit is shared by all specie Rewards', async () => {
    const existing = Array.from({ length: 10 }, (): SavedPet => ({
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, greetings, farm } = farmWith(existing);

    await honourAddPet(redemption({ rewardTitle: 'Добавить собаку в IDE', userInput: 'brown' }), farm, species);

    assert.equal(pets.length, 10);
    assert.deepEqual(greetings, []);
});

test('a farm that already has fifty pets rejects the request', async () => {
    const existing = Array.from({ length: 50 }, (): SavedPet => ({
        name: 'Barn',
        specie: 'Cat',
        color: 'Black',
    }));
    const { pets, greetings, farm } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'black' }), farm, species);

    assert.equal(pets.length, 50);
    assert.deepEqual(greetings, []);
});

test('a freed slot counts immediately', async () => {
    const existing = Array.from({ length: 9 }, (): SavedPet => ({
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, farm } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'black' }), farm, species);

    assert.equal(pets.length, 10);
});

test('Species without Variants require no input and ignore any text', async () => {
    for (const [rewardTitle, specie] of [
        ['Добавить динозавра в IDE', 'Dino'],
        ['Добавить утку в IDE', 'Duck'],
        ['Добавить енота в IDE', 'Raccoon'],
        ['Добавить лошадь в IDE', 'Horse'],
    ]) {
        for (const userInput of ['', 'black', 'random', 'cat, black']) {
            const { pets, farm } = farmWith();
            await honourAddPet(redemption({ rewardTitle, userInput }), farm, petSpecies, () => {
                throw new Error('a Specie without Variants needs no random choice');
            });
            assert.equal(pets[0]?.specie, specie);
            assert.equal(pets[0]?.color, '');
        }
    }
});

test('removal, legacy and unknown Reward titles are left alone', async () => {
    for (const rewardTitle of [
        'Удалить питомца из IDE', 'Добавить питомца в IDE', 'Other reward',
        'добавить кота в IDE', 'Добавить кота в IDE ', 'toString',
    ]) {
        const { pets, greetings, farm } = farmWith();
        const logs: string[] = [];
        await honourAddPet(redemption({ rewardTitle }), farm, species, Math.random, message => logs.push(message));
        assert.deepEqual(pets, []);
        assert.deepEqual(greetings, []);
        assert.deepEqual(logs, []);
    }
});


test('pets the farmer added by hand do not fill a viewer slot', async () => {
    const existing = Array.from({ length: 10 }, (): SavedPet => ({
        name: 'Barn',
        specie: 'Cat',
        color: 'Black',
    }));
    const { pets, farm } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'black' }), farm, species);

    assert.equal(pets.length, 11);
    assert.equal(pets[10]?.twitchUserId, '99');
});

test('a failed save leaves no partial Pet or greeting', async () => {
    const { pets, greetings, farm } = farmWith();
    farm.add = pet => {
        pets.push(pet);
        throw new Error('save failed');
    };

    await assert.rejects(
        () => honourAddPet(redemption({ userInput: 'black' }), farm, species),
        /save failed/,
    );
    assert.deepEqual(pets, []);
    assert.deepEqual(greetings, []);
});

test('an unreadable save is reported without a greeting', async () => {
    const { greetings } = farmWith();
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
        () => honourAddPet(redemption({ userInput: 'black' }), farm, species),
        /save unreadable/,
    );

    assert.deepEqual(greetings, []);
});

test('every specie can be added from a redemption', async () => {
    const rewards = {
        Cat: 'Добавить кота в IDE',
        Dog: 'Добавить собаку в IDE',
        Turtle: 'Добавить черепаху в IDE',
        Dino: 'Добавить динозавра в IDE',
        Duck: 'Добавить утку в IDE',
        Raccoon: 'Добавить енота в IDE',
        Goat: 'Добавить козу в IDE',
        Sheep: 'Добавить овечку в IDE',
        Ostrich: 'Добавить страуса в IDE',
        Pig: 'Добавить хрюшку в IDE',
        Rabbit: 'Добавить кролика в IDE',
        Chicken: 'Добавить курицу в IDE',
        Cow: 'Добавить корову в IDE',
        Parrot: 'Добавить попугая в IDE',
        Horse: 'Добавить лошадь в IDE',
        Junimo: 'Добавить джунимо в IDE',
    };
    assert.deepEqual(Object.keys(petSpecies), Object.keys(rewards));

    for (const [specie, rewardTitle] of Object.entries(rewards)) {
        const variants = petSpecies[specie];
        const world = farmWith();
        await honourAddPet(redemption({ rewardTitle, userInput: variants[0] ?? '', userId: specie }), world.farm, petSpecies);
        assert.equal(world.pets[0]?.specie, specie);
        assert.equal(world.pets[0]?.color, variants[0] ?? '');
    }
});

function redemption(overrides: Partial<Redemption> = {}): Redemption {
    return {
        id: 'redemption-1',
        broadcasterUserId: '42',
        userId: '99',
        userLogin: 'viewer',
        userName: 'Viewer',
        userInput: 'black',
        rewardId: 'add-id',
        rewardTitle: 'Добавить кота в IDE',
        ...overrides,
    };
}

function farmWith(pets: SavedPet[] = []) {
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
