import assert from 'node:assert/strict';
import test from 'node:test';
import { petSpecies } from '../src/pets/catalog.ts';
import { honourAddPet, type SavedPet } from '../src/twitch/add-pet.ts';
import type { Redemption } from '../src/twitch/connection.ts';

const species = {
    Cat: ['Black', 'Gray'],
    Chicken: ['White Adult', 'Brown Baby'],
    Dino: [],
};

test('a viewer who redeems cat, black gets a cat named with their display name', async () => {
    const { pets, greetings, settled, farm, desk } = farmWith();

    await honourAddPet(redemption({ userInput: 'cat, black' }), farm, desk, species);

    assert.deepEqual(pets, [{
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }]);
    assert.deepEqual(greetings, ['Say hi to Viewer!']);
    assert.deepEqual(settled, ['FULFILLED']);
});

test('a viewer who copies the prompt literally still gets the pet', async () => {
    const copied = farmWith();
    await honourAddPet(redemption({ userInput: '{Cat, Black}' }), copied.farm, copied.desk, species);
    assert.deepEqual(copied.pets, [{
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }]);

    const quoted = farmWith();
    await honourAddPet(redemption({ userInput: '"cat, black"' }), quoted.farm, quoted.desk, species);
    assert.equal(quoted.pets[0]?.color, 'Black');
    assert.equal(quoted.settled[0], 'FULFILLED');
});

test('a two-word variant is kept whole', async () => {
    const { pets, farm, desk } = farmWith();

    await honourAddPet(redemption({ userInput: 'chicken, white adult' }), farm, desk, species);

    assert.equal(pets[0]?.specie, 'Chicken');
    assert.equal(pets[0]?.color, 'White Adult');
});

test('a missing variant is chosen at random', async () => {
    const { pets, settled, farm, desk } = farmWith();

    await honourAddPet(redemption({ userInput: 'cat,' }), farm, desk, species, () => 0.99);

    assert.equal(pets[0]?.color, 'Gray');
    assert.deepEqual(settled, ['FULFILLED']);
});

test('an unreadable redemption is refunded without a pet or a greeting', async () => {
    const missingComma = farmWith();
    await honourAddPet(redemption({ userInput: 'cat black' }), missingComma.farm, missingComma.desk, species);
    assert.deepEqual(missingComma.pets, []);
    assert.deepEqual(missingComma.greetings, []);
    assert.deepEqual(missingComma.settled, ['CANCELED']);

    const unknownSpecie = farmWith();
    await honourAddPet(redemption({ userInput: 'dragon, red' }), unknownSpecie.farm, unknownSpecie.desk, species);
    assert.deepEqual(unknownSpecie.pets, []);
    assert.deepEqual(unknownSpecie.settled, ['CANCELED']);

    const unknownVariant = farmWith();
    await honourAddPet(redemption({ userInput: 'cat, plaid' }), unknownVariant.farm, unknownVariant.desk, species);
    assert.deepEqual(unknownVariant.pets, []);
    assert.deepEqual(unknownVariant.greetings, []);
    assert.deepEqual(unknownVariant.settled, ['CANCELED']);
});

test('a display name the nameplate font cannot draw is replaced by the login', async () => {
    const { pets, greetings, farm, desk } = farmWith();

    await honourAddPet(redemption({
        userName: 'Валерия',
        userLogin: 'valeria',
        userInput: 'cat, black',
    }), farm, desk, species);

    assert.equal(pets[0]?.name, 'valeria');
    assert.deepEqual(greetings, ['Say hi to valeria!']);
});

test('a display name is kept when only its accents sit outside the font', async () => {
    const { pets, farm, desk } = farmWith();

    await honourAddPet(redemption({
        userName: 'José',
        userLogin: 'jose',
        userInput: 'cat, black',
    }), farm, desk, species);

    assert.equal(pets[0]?.name, 'José');
});

test('a display name longer than the nameplate is stored whole', async () => {
    const { pets, farm, desk } = farmWith();

    await honourAddPet(redemption({ userName: 'LongDisplayName', userInput: 'cat, black' }), farm, desk, species);

    assert.equal(pets[0]?.name, 'LongDisplayName');
});

test('an eleventh living pet for one viewer is refunded', async () => {
    const existing = Array.from({ length: 10 }, (): SavedPet => ({
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, greetings, settled, farm, desk } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'cat, black' }), farm, desk, species);

    assert.equal(pets.length, 10);
    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, ['CANCELED']);
});

test('a farm that already has fifty pets refunds the redemption', async () => {
    const existing = Array.from({ length: 50 }, (): SavedPet => ({
        name: 'Barn',
        specie: 'Cat',
        color: 'Black',
    }));
    const { pets, greetings, settled, farm, desk } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'cat, black' }), farm, desk, species);

    assert.equal(pets.length, 50);
    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, ['CANCELED']);
});

test('a freed slot counts immediately', async () => {
    const existing = Array.from({ length: 9 }, (): SavedPet => ({
        name: 'Viewer',
        specie: 'Cat',
        color: 'Black',
        twitchUserId: '99',
    }));
    const { pets, settled, farm, desk } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'cat, black' }), farm, desk, species);

    assert.equal(pets.length, 10);
    assert.deepEqual(settled, ['FULFILLED']);
});

test('a specie with no variants gets an empty color when none is written', async () => {
    const { pets, farm, desk } = farmWith();

    await honourAddPet(redemption({ userInput: 'dino,' }), farm, desk, species);

    assert.equal(pets[0]?.specie, 'Dino');
    assert.equal(pets[0]?.color, '');
});

test('a redemption of another reward is left alone', async () => {
    const { pets, greetings, settled, farm, desk } = farmWith();

    await honourAddPet(redemption({
        userInput: '',
        rewardTitle: 'Удалить питомца из IDE',
    }), farm, desk, species);

    assert.deepEqual(pets, []);
    assert.deepEqual(greetings, []);
    assert.deepEqual(settled, []);
});

test('a pet is saved only after Twitch accepts the redemption', async () => {
    const { pets, greetings, farm } = farmWith();

    await assert.rejects(
        () => honourAddPet(redemption({ userInput: 'cat, black' }), farm, {
            async settle() {
                throw new Error('Twitch request failed (403).');
            },
        }, species),
        /403/,
    );

    assert.deepEqual(pets, []);
    assert.deepEqual(greetings, []);
});

test('pets the farmer added by hand do not fill a viewer slot', async () => {
    const existing = Array.from({ length: 10 }, (): SavedPet => ({
        name: 'Barn',
        specie: 'Cat',
        color: 'Black',
    }));
    const { pets, settled, farm, desk } = farmWith(existing);

    await honourAddPet(redemption({ userInput: 'cat, black' }), farm, desk, species);

    assert.equal(pets.length, 11);
    assert.equal(pets[10]?.twitchUserId, '99');
    assert.deepEqual(settled, ['FULFILLED']);
});

test('every specie can be added from a redemption', async () => {
    assert.deepEqual(Object.keys(petSpecies), [
        'Cat', 'Dog', 'Turtle', 'Dino', 'Duck', 'Raccoon', 'Goat', 'Sheep',
        'Ostrich', 'Pig', 'Rabbit', 'Chicken', 'Cow', 'Parrot', 'Horse', 'Junimo',
    ]);

    for (const specie of Object.keys(petSpecies)) {
        const variants = petSpecies[specie];
        const input = variants.length === 0 ? `${specie},` : `${specie}, ${variants[0]}`;
        const world = farmWith();
        await honourAddPet(redemption({ userInput: input, userId: specie }), world.farm, world.desk, petSpecies);
        assert.equal(world.pets[0]?.specie, specie);
        assert.equal(world.pets[0]?.color, variants[0] ?? '');
        assert.equal(world.settled[0], 'FULFILLED');
    }
});

function redemption(overrides: Partial<Redemption> = {}): Redemption {
    return {
        id: 'redemption-1',
        broadcasterUserId: '42',
        userId: '99',
        userLogin: 'viewer',
        userName: 'Viewer',
        userInput: 'cat, black',
        rewardId: 'add-id',
        rewardTitle: 'Добавить питомца в IDE',
        ...overrides,
    };
}

function farmWith(pets: SavedPet[] = []) {
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
