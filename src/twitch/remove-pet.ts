import { type Farm, type RedemptionDesk, type RedemptionLog } from './add-pet.ts';
import { removePetRewardTitle, type Redemption } from './connection.ts';

export type { SavedPet } from './add-pet.ts';

export async function honourRemovePet(
    redemption: Redemption,
    farm: Farm,
    desk: RedemptionDesk,
    random: () => number = Math.random,
    log: RedemptionLog = () => {},
): Promise<void> {
    if (redemption.rewardTitle !== removePetRewardTitle) {
        return;
    }
    const owned = farm.pets().filter(pet => pet.twitchUserId === redemption.userId);
    if (owned.length === 0) {
        log(`remove canceled for ${redemption.userName} (${redemption.userLogin}): Viewer has no Pets`);
        await desk.settle('CANCELED');
        return;
    }
    const pet = owned[Math.floor(random() * owned.length)];
    if (pet === undefined || !farm.remove(pet)) {
        log(`remove canceled for ${redemption.userName} (${redemption.userLogin}): selected Pet is no longer on the farm`);
        await desk.settle('CANCELED');
        return;
    }
    log(`removing Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    try {
        await desk.settle('FULFILLED');
    } catch (error) {
        farm.add(pet);
        log(`remove failed for ${redemption.userName} (${redemption.userLogin}): restored Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''})`);
        throw error;
    }
    log(`removed Pet ${pet.name} (${pet.specie}${pet.color ? `, ${pet.color}` : ''}) for ${redemption.userName} (${redemption.userLogin})`);
    farm.greet(`Bye ${pet.name}!`);
}
