import type { Redemption } from './connection.ts';
import { specieForAddPetReward } from './rewards.ts';

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

export type RedemptionLog = (message: string) => void;

// Glyphs in media/fonts/StardewValley.ttf. Accents are judged after the nameplate strips them; the stored name keeps them.
const NAMEPLATE_FONT = new Set("!\"#$%&'()*+,-./0123456789:;=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz{}~");
const VIEWER_PET_LIMIT = 10;
const FARM_PET_LIMIT = 50;

export async function honourAddPet(
    redemption: Redemption,
    farm: Farm,
    species: SpeciesCatalog,
    random: () => number = Math.random,
    log: RedemptionLog = () => {},
): Promise<void> {
    const specie = specieForAddPetReward(redemption.rewardTitle);
    if (specie === undefined) {
        return;
    }
    const delivered = addChosenPet(redemption, specie, farm, species, random, log);
    if (delivered !== undefined) {
        farm.greet(`Say hi to ${delivered.name}!`);
    }
}

function addChosenPet(
    redemption: Redemption,
    specie: string,
    farm: Farm,
    species: SpeciesCatalog,
    random: () => number,
    log: RedemptionLog,
): SavedPet | undefined {
    const choice = readChoice(specie, redemption.userInput, species, random);
    if (choice === undefined) {
        log(`add rejected for ${redemption.userName} (${redemption.userLogin}): invalid Pet choice ${JSON.stringify(redemption.userInput)}; manual refund required in Twitch`);
        return;
    }
    const pets = farm.pets();
    const owned = pets.filter(pet => pet.twitchUserId === redemption.userId).length;
    if (pets.length >= FARM_PET_LIMIT) {
        log(`add rejected for ${redemption.userName} (${redemption.userLogin}): farm limit (${FARM_PET_LIMIT}); requested ${choice.specie}${choice.color ? `, ${choice.color}` : ''}; manual refund required in Twitch`);
        return;
    }
    if (owned >= VIEWER_PET_LIMIT) {
        log(`add rejected for ${redemption.userName} (${redemption.userLogin}): Viewer limit (${VIEWER_PET_LIMIT}); requested ${choice.specie}${choice.color ? `, ${choice.color}` : ''}; manual refund required in Twitch`);
        return;
    }
    const pet: SavedPet = {
        name: petName(redemption.userName, redemption.userLogin),
        specie: choice.specie,
        color: choice.color,
        twitchUserId: redemption.userId,
    };
    log(`adding Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
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

function readChoice(specie: string, input: string, species: SpeciesCatalog, random: () => number): { specie: string; color: string } | undefined {
    const variants = species[specie];
    if (variants === undefined) {
        return undefined;
    }
    if (variants.length === 0) {
        return { specie, color: '' };
    }
    const cleaned = input.replace(/[()[\]{}"'«»“”„]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleaned === '' || cleaned === 'random') {
        return { specie, color: variants[Math.floor(random() * variants.length)] };
    }
    const color = variants.find(variant => variant.toLowerCase() === cleaned);
    if (color === undefined) {
        return undefined;
    }
    return { specie, color };
}
