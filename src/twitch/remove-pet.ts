import { type Farm, type RedemptionDesk } from './add-pet.ts';
import { removePetRewardTitle, type Redemption } from './connection.ts';

export type { SavedPet } from './add-pet.ts';

export async function honourRemovePet(
    redemption: Redemption,
    farm: Farm,
    desk: RedemptionDesk,
    random: () => number = Math.random,
): Promise<void> {
    if (redemption.rewardTitle !== removePetRewardTitle) {
        return;
    }
    const owned = farm.pets().filter(pet => pet.twitchUserId === redemption.userId);
    if (owned.length === 0) {
        await desk.settle('CANCELED');
        return;
    }
    const pet = owned[Math.floor(random() * owned.length)];
    if (pet === undefined || !farm.remove(pet)) {
        await desk.settle('CANCELED');
        return;
    }
    try {
        await desk.settle('FULFILLED');
    } catch (error) {
        farm.add(pet);
        throw error;
    }
    farm.greet(`Bye ${pet.name}!`);
}
