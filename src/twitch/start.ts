import * as vscode from 'vscode';
import { petSpecies } from '../pets/catalog';
import { honourAddPet, type Farm } from './add-pet';
import { Clock, createTwitchConnection } from './connection';
import { createTwitchApi, openTwitchSocket } from './live';

const clock: Clock = {
    now() {
        return Date.now();
    },
    wait(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    },
};

export function startTwitch(context: vscode.ExtensionContext, lockDir: string, farm: Farm) {
    const clientId = vscode.workspace.getConfiguration('stardew-pets').get<string>('twitch.clientId') ?? '';
    const connection = createTwitchConnection({
        clientId,
        lockDir,
        secrets: {
            get(key) {
                return Promise.resolve(context.secrets.get(key));
            },
            store(key, value) {
                return Promise.resolve(context.secrets.store(key, value));
            },
            delete(key) {
                return Promise.resolve(context.secrets.delete(key));
            },
        },
        notify: {
            showCode(code, uri) {
                void vscode.window.showInformationMessage(`Twitch code ${code}. Enter it at ${uri}`, 'Open').then(choice => {
                    if (choice === 'Open') {
                        void vscode.env.openExternal(vscode.Uri.parse(uri));
                    }
                });
            },
            showError(message) {
                void vscode.window.showErrorMessage(message);
            },
        },
        clock,
        twitch: createTwitchApi(),
        openSocket: openTwitchSocket,
        rewardCosts: {
            add() {
                return vscode.workspace.getConfiguration('stardew-pets').get<number>('twitch.rewardCost') ?? 1000;
            },
            remove() {
                return vscode.workspace.getConfiguration('stardew-pets').get<number>('twitch.removeRewardCost') ?? 100;
            },
        },
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('stardew-pets.connectTwitch', () => connection.connect('command')),
        vscode.commands.registerCommand('stardew-pets.disconnectTwitch', () => connection.disconnect()),
        { dispose: () => { connection.dispose(); } },
    );

    connection.onEvent(event => {
        if (event.type !== 'redemption') {
            return;
        }
        const redemption = event.redemption;
        void honourAddPet(redemption, farm, {
            settle(status) {
                return connection.settleRedemption(redemption.id, redemption.rewardId, status);
            },
        }, petSpecies).catch(error => {
            const message = error instanceof Error ? error.message : 'Twitch redemption failed.';
            void vscode.window.showErrorMessage(message);
        });
    });

    void connection.connect('startup').catch(error => {
        const message = error instanceof Error ? error.message : 'Twitch connection failed.';
        void vscode.window.showErrorMessage(message);
    });
}
