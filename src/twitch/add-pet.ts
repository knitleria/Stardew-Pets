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

export type RedemptionLog = (message: string) => void;

// Glyphs in media/fonts/StardewValley.ttf. Accents are judged after the nameplate strips them; the stored name keeps them.
const NAMEPLATE_FONT = new Set("!\"#$%&'()*+,-./0123456789:;=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz{}~");
const VIEWER_PET_LIMIT = 10;
const FARM_PET_LIMIT = 50;

export async function refundRedemption(desk: RedemptionDesk): Promise<void> {
    try {
        await desk.settle('CANCELED');
    } catch {
        // The caller reports the original error. A failed refund must not hide it.
    }
}

export async function honourAddPet(
    redemption: Redemption,
    farm: Farm,
    desk: RedemptionDesk,
    species: SpeciesCatalog,
    random: () => number = Math.random,
    log: RedemptionLog = () => {},
): Promise<void> {
    if (redemption.rewardTitle !== addPetRewardTitle) {
        return;
    }
    let delivered: SavedPet | undefined;
    try {
        delivered = await addChosenPet(redemption, farm, desk, species, random, log);
    } catch (error) {
        await refundRedemption(desk);
        throw error;
    }
    if (delivered !== undefined) {
        farm.greet(`Say hi to ${delivered.name}!`);
    }
}

async function addChosenPet(
    redemption: Redemption,
    farm: Farm,
    desk: RedemptionDesk,
    species: SpeciesCatalog,
    random: () => number,
    log: RedemptionLog,
): Promise<SavedPet | undefined> {
    const choice = readChoice(redemption.userInput, species, random);
    if (choice === undefined) {
        log(`add canceled for ${redemption.userName} (${redemption.userLogin}): invalid Pet choice ${JSON.stringify(redemption.userInput)}`);
        await desk.settle('CANCELED');
        return;
    }
    const pets = farm.pets();
    const owned = pets.filter(pet => pet.twitchUserId === redemption.userId).length;
    if (pets.length >= FARM_PET_LIMIT) {
        log(`add canceled for ${redemption.userName} (${redemption.userLogin}): farm limit (${FARM_PET_LIMIT}); requested ${choice.specie}${choice.color ? `, ${choice.color}` : ''}`);
        await desk.settle('CANCELED');
        return;
    }
    if (owned >= VIEWER_PET_LIMIT) {
        log(`add canceled for ${redemption.userName} (${redemption.userLogin}): Viewer limit (${VIEWER_PET_LIMIT}); requested ${choice.specie}${choice.color ? `, ${choice.color}` : ''}`);
        await desk.settle('CANCELED');
        return;
    }
    const pet: SavedPet = {
        name: petName(redemption.userName, redemption.userLogin),
        specie: choice.specie,
        color: choice.color,
        twitchUserId: redemption.userId,
    };
    log(`adding Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    await desk.settle('FULFILLED');
    try {
        farm.add(pet);
    } catch (error) {
        farm.remove(pet);
        throw error;
    }
    log(`added Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    return pet;
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
