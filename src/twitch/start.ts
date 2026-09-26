import * as vscode from 'vscode';
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

export function startTwitch(context: vscode.ExtensionContext, lockDir: string) {
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

    void connection.connect('startup').catch(error => {
        const message = error instanceof Error ? error.message : 'Twitch connection failed.';
        void vscode.window.showErrorMessage(message);
    });
}
