import type { Farm, RedemptionLog } from './add-pet.ts';
import type { Redemption } from './connection.ts';
import { removePetRewardTitle } from './rewards.ts';

export type { SavedPet } from './add-pet.ts';

export async function honourRemovePet(
    redemption: Redemption,
    farm: Farm,
    random: () => number = Math.random,
    log: RedemptionLog = () => {},
): Promise<void> {
    if (redemption.rewardTitle !== removePetRewardTitle) {
        return;
    }
    const removedName = removeChosenPet(redemption, farm, random, log);
    if (removedName !== undefined) {
        farm.greet(`Bye ${removedName}!`);
    }
}

function removeChosenPet(
    redemption: Redemption,
    farm: Farm,
    random: () => number,
    log: RedemptionLog,
): string | undefined {
    const owned = farm.pets().filter(pet => pet.twitchUserId === redemption.userId);
    if (owned.length === 0) {
        log(`remove rejected for ${redemption.userName} (${redemption.userLogin}): Viewer has no Pets; manual refund required in Twitch`);
        return;
    }
    const pet = owned[Math.floor(random() * owned.length)];
    if (pet === undefined || !farm.remove(pet)) {
        log(`remove rejected for ${redemption.userName} (${redemption.userLogin}): selected Pet is no longer on the farm; manual refund required in Twitch`);
        return;
    }
    log(`removing Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    log(`removed Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    return pet.name;
}
