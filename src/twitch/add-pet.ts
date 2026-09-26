import { addPetRewardTitle, type Redemption } from './connection.ts';

export type SavedPet = {
    name: string;
    specie: string;
    color: string;
    twitchUserId?: string;
};

export type SpeciesCatalog = Readonly<Record<string, readonly string[]>>;

export type Farm = {
    pets(): readonly SavedPet[];
    add(pet: SavedPet): void;
    remove(pet: SavedPet): boolean;
    greet(text: string): void;
};

export type RedemptionDesk = {
    settle(status: 'FULFILLED' | 'CANCELED'): Promise<void>;
};

// Glyphs in media/fonts/StardewValley.ttf. Accents are judged after the nameplate strips them; the stored name keeps them.
const NAMEPLATE_FONT = new Set("!\"#$%&'()*+,-./0123456789:;=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz{}~");
const VIEWER_PET_LIMIT = 10;
const FARM_PET_LIMIT = 50;

export async function honourAddPet(
    redemption: Redemption,
    farm: Farm,
    desk: RedemptionDesk,
    species: SpeciesCatalog,
    random: () => number = Math.random,
): Promise<void> {
    if (redemption.rewardTitle !== addPetRewardTitle) {
        return;
    }
    const choice = readChoice(redemption.userInput, species, random);
    if (choice === undefined) {
        await desk.settle('CANCELED');
        return;
    }
    const pets = farm.pets();
    const owned = pets.filter(pet => pet.twitchUserId === redemption.userId).length;
    if (pets.length >= FARM_PET_LIMIT || owned >= VIEWER_PET_LIMIT) {
        await desk.settle('CANCELED');
        return;
    }
    const pet: SavedPet = {
        name: petName(redemption.userName, redemption.userLogin),
        specie: choice.specie,
        color: choice.color,
        twitchUserId: redemption.userId,
    };
    await desk.settle('FULFILLED');
    farm.add(pet);
    farm.greet(`Say hi to ${pet.name}!`);
}

function petName(userName: string, userLogin: string): string {
    const drawable = userName.normalize('NFD').replace(/\p{M}/gu, '');
    for (const char of drawable) {
        if (!NAMEPLATE_FONT.has(char)) {
            return userLogin;
        }
    }
    return userName;
}

function readChoice(input: string, species: SpeciesCatalog, random: () => number): { specie: string; color: string } | undefined {
    const cleaned = input.replace(/[()[\]{}"'«»“”„]/g, '').replace(/\s+/g, ' ').trim();
    const comma = cleaned.indexOf(',');
    if (comma < 0) {
        return undefined;
    }
    const specieText = cleaned.slice(0, comma).trim();
    const colorText = cleaned.slice(comma + 1).trim();
    const specie = Object.keys(species).find(key => key.toLowerCase() === specieText.toLowerCase());
    if (specie === undefined) {
        return undefined;
    }
    const variants = species[specie];
    if (colorText === '') {
        if (variants.length === 0) {
            return { specie, color: '' };
        }
        return { specie, color: variants[Math.floor(random() * variants.length)] };
    }
    const color = variants.find(variant => variant.toLowerCase() === colorText.toLowerCase());
    if (color === undefined) {
        return undefined;
    }
    return { specie, color };
}
