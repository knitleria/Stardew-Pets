const addPetSpecies = new Map<string, string>([
    ['Добавить кота в IDE', 'Cat'],
    ['Добавить собаку в IDE', 'Dog'],
    ['Добавить черепаху в IDE', 'Turtle'],
    ['Добавить динозавра в IDE', 'Dino'],
    ['Добавить утку в IDE', 'Duck'],
    ['Добавить енота в IDE', 'Raccoon'],
    ['Добавить козу в IDE', 'Goat'],
    ['Добавить овечку в IDE', 'Sheep'],
    ['Добавить страуса в IDE', 'Ostrich'],
    ['Добавить хрюшку в IDE', 'Pig'],
    ['Добавить кролика в IDE', 'Rabbit'],
    ['Добавить курицу в IDE', 'Chicken'],
    ['Добавить корову в IDE', 'Cow'],
    ['Добавить попугая в IDE', 'Parrot'],
    ['Добавить лошадь в IDE', 'Horse'],
    ['Добавить джунимо в IDE', 'Junimo'],
]);

export const removePetRewardTitle = 'Удалить питомца из IDE';

export function specieForAddPetReward(title: string): string | undefined {
    return addPetSpecies.get(title);
}
