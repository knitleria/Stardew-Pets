import * as fs from 'node:fs';
import * as path from 'node:path';

export type ConnectReason = 'startup' | 'command';

export type TokenGrant = {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
};

export type StoredTokens = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};

export type DeviceCode = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
    expiresInSeconds: number;
};

export type DevicePoll =
    | { status: 'pending' }
    | { status: 'slow-down' }
    | { status: 'denied' }
    | { status: 'expired' }
    | { status: 'approved'; tokens: TokenGrant };

export type SecretStore = {
    get(key: string): Promise<string | undefined>;
    store(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
};

export type Notifier = {
    showCode(userCode: string, verificationUri: string): void;
    showError(message: string): void;
};

export type Clock = {
    now(): number;
    wait(ms: number): Promise<void>;
};

export type SubscriptionType =
    | 'stream.online'
    | 'stream.offline'
    | 'channel.channel_points_custom_reward_redemption.add';

export type ManagedReward = {
    id: string;
    title: string;
};

export type RewardUpdateInput = {
    clientId: string;
    accessToken: string;
    broadcasterUserId: string;
    id: string;
    cost?: number;
    prompt?: string;
    userInputRequired?: boolean;
    isEnabled?: boolean;
    isPaused?: boolean;
    skipRequestQueue?: boolean;
};

export type TwitchApi = {
    requestDeviceCode(clientId: string, scopes: readonly string[]): Promise<DeviceCode>;
    pollDeviceCode(clientId: string, deviceCode: string): Promise<DevicePoll>;
    refresh(clientId: string, refreshToken: string): Promise<TokenGrant | { rejected: true }>;
    currentUser(clientId: string, accessToken: string): Promise<{ id: string }>;
    isStreamLive(clientId: string, accessToken: string, userId: string): Promise<boolean>;
    subscribe(input: {
        clientId: string;
        accessToken: string;
        sessionId: string;
        type: SubscriptionType;
        broadcasterUserId: string;
    }): Promise<{ id: string }>;
    unsubscribe(input: { clientId: string; accessToken: string; id: string }): Promise<void>;
    listRewards(input: {
        clientId: string;
        accessToken: string;
        broadcasterUserId: string;
    }): Promise<{ rewards: ManagedReward[] } | { forbidden: true }>;
    updateReward(input: RewardUpdateInput): Promise<{ ok: true } | { forbidden: true }>;
    updateRedemption(input: {
        clientId: string;
        accessToken: string;
        broadcasterUserId: string;
        rewardId: string;
        redemptionId: string;
        status: 'FULFILLED' | 'CANCELED';
    }): Promise<void>;
};

export type TwitchSocket = {
    close(): void;
    onMessage(handler: (data: string) => void): void;
    onClose(handler: () => void): void;
    onError(handler: (error: Error) => void): void;
};

export type Redemption = {
    id: string;
    broadcasterUserId: string;
    userId: string;
    userLogin: string;
    userName: string;
    userInput: string;
    rewardId: string;
    rewardTitle: string;
};

export type TwitchEvent =
    | { type: 'stream.online' }
    | { type: 'stream.offline' }
    | { type: 'redemption'; redemption: Redemption };

export type TwitchConnection = {
    connect(reason: ConnectReason): Promise<void>;
    disconnect(): Promise<void>;
    onEvent(listener: (event: TwitchEvent) => void): () => void;
    settleRedemption(redemptionId: string, rewardId: string, status: 'FULFILLED' | 'CANCELED'): Promise<void>;
    dispose(): void;
};

export type RewardCosts = {
    add(): number;
    remove(): number;
};

export type TwitchDependencies = {
    clientId: string;
    lockDir: string;
    secrets: SecretStore;
    notify: Notifier;
    clock: Clock;
    twitch: TwitchApi;
    openSocket: (url: string) => TwitchSocket;
    rewardCosts?: RewardCosts;
};

export const twitchTokenKey = 'stardew-pets.twitch.tokens';
const TOKEN_KEY = twitchTokenKey;
const SCOPE = 'channel:manage:redemptions';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const REFRESH_LEEWAY_MS = 60_000;
export const addPetRewardTitle = 'Добавить питомца в IDE';
const REMOVE_REWARD_TITLE = 'Удалить питомца из IDE';
const ADD_REWARD_PROMPT = 'введи тип животного и окрас в формате {Cat, Black}';
const DEFAULT_ADD_COST = 1000;
const DEFAULT_REMOVE_COST = 100;
const CHANNEL_POINTS_UNAVAILABLE = 'Twitch channel points are only available for Affiliate and Partner channels.';

export function createTwitchConnection(dependencies: TwitchDependencies): TwitchConnection {
    let held: Lock | undefined;
    let activeSocket: TwitchSocket | undefined;
    let currentTokens: StoredTokens | undefined;
    let stopped = false;
    let reconnecting = false;
    let reconnectDelay = 1000;
    let followedReconnect = false;
    let announced = false;
    let refreshGeneration = 0;
    let sessionId: string | undefined;
    let socketAccessToken = '';
    let broadcasterUserId = '';
    let redemptionSubscriptionId: string | undefined;
    let addRewardId: string | undefined;
    let removeRewardId: string | undefined;
    const seenMessageIds = new Set<string>();
    const listeners = new Set<(event: TwitchEvent) => void>();
    const rewardCosts = dependencies.rewardCosts ?? {
        add: () => DEFAULT_ADD_COST,
        remove: () => DEFAULT_REMOVE_COST,
    };
    return {
        async connect(reason) {
            if (held === undefined) {
                held = tryTakeLock(dependencies.lockDir);
                if (held === undefined) {
                    return;
                }
            }
            if (activeSocket !== undefined) {
                return;
            }
            const existing = await dependencies.secrets.get(TOKEN_KEY);
            if (dependencies.clientId === '' && (reason === 'command' || existing !== undefined)) {
                dependencies.notify.showError('Set stardew-pets.twitch.clientId to a Twitch application client ID.');
                return;
            }
            if (existing !== undefined) {
                const tokens = await ensureFresh(JSON.parse(existing) as StoredTokens);
                if (tokens === undefined) {
                    return;
                }
                await listen(tokens);
                return;
            }
            if (reason !== 'command') {
                return;
            }
            const signedIn = await signIn();
            if (signedIn !== undefined) {
                scheduleRefresh(signedIn);
                await listen(signedIn);
            }
        },
        async disconnect() {
            stopped = true;
            await setRewardsPaused(true);
            activeSocket?.close();
            activeSocket = undefined;
        },
        onEvent(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        settleRedemption(redemptionId, rewardId, status) {
            return dependencies.twitch.updateRedemption({
                clientId: dependencies.clientId,
                accessToken: socketAccessToken,
                broadcasterUserId,
                rewardId,
                redemptionId,
                status,
            });
        },
        dispose() {
            stopped = true;
            void setRewardsPaused(true);
            activeSocket?.close();
            activeSocket = undefined;
            held?.release();
            held = undefined;
        },
    };

    async function signIn(): Promise<StoredTokens | undefined> {
        const device = await dependencies.twitch.requestDeviceCode(dependencies.clientId, [SCOPE]);
        dependencies.notify.showCode(device.userCode, device.verificationUri);
        let intervalMs = device.intervalSeconds * 1000;
        let polled = await dependencies.twitch.pollDeviceCode(dependencies.clientId, device.deviceCode);
        while (polled.status === 'pending' || polled.status === 'slow-down') {
            if (polled.status === 'slow-down') {
                intervalMs += device.intervalSeconds * 1000;
            }
            await dependencies.clock.wait(intervalMs);
            polled = await dependencies.twitch.pollDeviceCode(dependencies.clientId, device.deviceCode);
        }
        if (polled.status === 'denied') {
            dependencies.notify.showError('Twitch authorization was denied.');
            return undefined;
        }
        if (polled.status === 'expired') {
            dependencies.notify.showError('The Twitch code expired. Run Connect again.');
            return undefined;
        }
        if (polled.status !== 'approved') {
            return undefined;
        }
        return keep({
            accessToken: polled.tokens.accessToken,
            refreshToken: polled.tokens.refreshToken,
            expiresAt: dependencies.clock.now() + polled.tokens.expiresInSeconds * 1000,
        });
    }

    async function keep(tokens: StoredTokens): Promise<StoredTokens> {
        currentTokens = tokens;
        socketAccessToken = tokens.accessToken;
        await dependencies.secrets.store(TOKEN_KEY, JSON.stringify(tokens));
        return tokens;
    }

    async function ensureFresh(tokens: StoredTokens): Promise<StoredTokens | undefined> {
        if (tokens.expiresAt - dependencies.clock.now() > REFRESH_LEEWAY_MS) {
            scheduleRefresh(tokens);
            return tokens;
        }
        const refreshed = await dependencies.twitch.refresh(dependencies.clientId, tokens.refreshToken);
        if ('rejected' in refreshed) {
            const signedIn = await signIn();
            if (signedIn !== undefined) {
                scheduleRefresh(signedIn);
            }
            return signedIn;
        }
        const stored = await keep({
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: dependencies.clock.now() + refreshed.expiresInSeconds * 1000,
        });
        scheduleRefresh(stored);
        return stored;
    }

    function scheduleRefresh(tokens: StoredTokens) {
        const delay = tokens.expiresAt - dependencies.clock.now() - REFRESH_LEEWAY_MS;
        if (delay <= 0) {
            return;
        }
        const generation = ++refreshGeneration;
        void dependencies.clock.wait(delay).then(() => {
            if (generation !== refreshGeneration || stopped) {
                return;
            }
            if (tokens.expiresAt - dependencies.clock.now() > REFRESH_LEEWAY_MS) {
                return;
            }
            void ensureFresh(tokens);
        });
    }

    async function listen(tokens: StoredTokens) {
        stopped = false;
        currentTokens = tokens;
        socketAccessToken = tokens.accessToken;
        try {
            const user = await dependencies.twitch.currentUser(dependencies.clientId, tokens.accessToken);
            broadcasterUserId = user.id;
            if (!await bindRewards()) {
                return;
            }
            activeSocket = dependencies.openSocket(EVENTSUB_URL);
            attach(activeSocket);
        } catch (error) {
            if (!announced) {
                announced = true;
                report(error);
            }
            void reconnect().catch(report);
        }
    }

    function attach(socket: TwitchSocket) {
        socket.onMessage(data => {
            void onSocketMessage(data).catch(report);
        });
        socket.onClose(() => {
            if (socket !== activeSocket) {
                return;
            }
            void reconnect().catch(report);
        });
        socket.onError(error => {
            if (!announced) {
                announced = true;
                dependencies.notify.showError(error.message);
            }
            socket.close();
        });
    }

    async function reconnect() {
        if (stopped || reconnecting || currentTokens === undefined) {
            return;
        }
        if (!announced) {
            announced = true;
            dependencies.notify.showError('Twitch connection lost. Reconnecting.');
        }
        void setRewardsPaused(true);
        reconnecting = true;
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
        await dependencies.clock.wait(delay);
        reconnecting = false;
        if (stopped || currentTokens === undefined) {
            return;
        }
        await listen(currentTokens);
    }

    async function onSocketMessage(data: string) {
        const message = JSON.parse(data) as {
            metadata: { message_id?: string; message_type: string; subscription_type?: string };
            payload: {
                session?: { id: string; reconnect_url?: string | null };
                event?: {
                    id: string;
                    broadcaster_user_id: string;
                    user_id: string;
                    user_login: string;
                    user_name: string;
                    user_input?: string;
                    reward: { id: string; title: string };
                };
            };
        };
        if (message.metadata.message_type === 'session_reconnect') {
            const url = message.payload.session?.reconnect_url;
            if (url === undefined || url === null) {
                return;
            }
            followedReconnect = true;
            const socket = dependencies.openSocket(url);
            activeSocket = socket;
            attach(socket);
            return;
        }
        if (message.metadata.message_type === 'session_welcome') {
            announced = false;
            reconnectDelay = 1000;
            sessionId = message.payload.session?.id;
            if (sessionId === undefined) {
                return;
            }
            if (followedReconnect) {
                followedReconnect = false;
                return;
            }
            await subscribe('stream.online');
            await subscribe('stream.offline');
            const currentlyLive = await dependencies.twitch.isStreamLive(
                dependencies.clientId,
                socketAccessToken,
                broadcasterUserId,
            );
            if (currentlyLive) {
                redemptionSubscriptionId = (await subscribe('channel.channel_points_custom_reward_redemption.add')).id;
                await setRewardsPaused(false);
            }
            return;
        }
        if (message.metadata.message_type !== 'notification') {
            return;
        }
        const messageId = message.metadata.message_id;
        if (messageId !== undefined) {
            if (seenMessageIds.has(messageId)) {
                return;
            }
            seenMessageIds.add(messageId);
        }
        if (message.metadata.subscription_type === 'stream.online') {
            emit({ type: 'stream.online' });
            if (redemptionSubscriptionId === undefined) {
                redemptionSubscriptionId = (await subscribe('channel.channel_points_custom_reward_redemption.add')).id;
            }
            await setRewardsPaused(false);
            return;
        }
        if (message.metadata.subscription_type === 'stream.offline') {
            emit({ type: 'stream.offline' });
            await setRewardsPaused(true);
            if (redemptionSubscriptionId !== undefined) {
                const id = redemptionSubscriptionId;
                await dependencies.twitch.unsubscribe({
                    clientId: dependencies.clientId,
                    accessToken: socketAccessToken,
                    id,
                });
                redemptionSubscriptionId = undefined;
            }
            return;
        }
        if (message.metadata.subscription_type === 'channel.channel_points_custom_reward_redemption.add') {
            const body = message.payload.event;
            if (body === undefined) {
                return;
            }
            emit({
                type: 'redemption',
                redemption: {
                    id: body.id,
                    broadcasterUserId: body.broadcaster_user_id,
                    userId: body.user_id,
                    userLogin: body.user_login,
                    userName: body.user_name,
                    userInput: body.user_input ?? '',
                    rewardId: body.reward.id,
                    rewardTitle: body.reward.title,
                },
            });
        }
    }

    function subscribe(type: SubscriptionType) {
        return dependencies.twitch.subscribe({
            clientId: dependencies.clientId,
            accessToken: socketAccessToken,
            sessionId: sessionId ?? '',
            type,
            broadcasterUserId,
        });
    }

    async function bindRewards(): Promise<boolean> {
        const listed = await dependencies.twitch.listRewards({
            clientId: dependencies.clientId,
            accessToken: socketAccessToken,
            broadcasterUserId,
        });
        if ('forbidden' in listed) {
            denyChannelPoints();
            return false;
        }
        addRewardId = await bindReward({
            title: addPetRewardTitle,
            cost: rewardCosts.add(),
            prompt: ADD_REWARD_PROMPT,
            userInputRequired: true,
            existing: listed.rewards,
        });
        removeRewardId = await bindReward({
            title: REMOVE_REWARD_TITLE,
            cost: rewardCosts.remove(),
            prompt: '',
            userInputRequired: false,
            existing: listed.rewards,
        });
        return true;
    }

    async function bindReward(spec: {
        title: string;
        cost: number;
        prompt: string;
        userInputRequired: boolean;
        existing: ManagedReward[];
    }): Promise<string | undefined> {
        const found = spec.existing.find(reward => reward.title === spec.title);
        if (found === undefined) {
            dependencies.notify.showError(`A Twitch reward named "${spec.title}" was not found. Create it on the channel, then Connect again.`);
            return undefined;
        }
        const updated = await dependencies.twitch.updateReward({
            clientId: dependencies.clientId,
            accessToken: socketAccessToken,
            broadcasterUserId,
            id: found.id,
            cost: spec.cost,
            prompt: spec.prompt,
            userInputRequired: spec.userInputRequired,
            isEnabled: true,
            isPaused: true,
            skipRequestQueue: false,
        });
        if ('forbidden' in updated) {
            dependencies.notify.showError(`A Twitch reward named "${spec.title}" already exists. Rename or delete it, then Connect again.`);
            return undefined;
        }
        return found.id;
    }

    async function setRewardsPaused(paused: boolean) {
        for (const id of [addRewardId, removeRewardId]) {
            if (id === undefined) {
                continue;
            }
            const updated = await dependencies.twitch.updateReward({
                clientId: dependencies.clientId,
                accessToken: socketAccessToken,
                broadcasterUserId,
                id,
                isPaused: paused,
            });
            if ('forbidden' in updated) {
                denyChannelPoints();
                return;
            }
        }
    }

    function denyChannelPoints() {
        dependencies.notify.showError(CHANNEL_POINTS_UNAVAILABLE);
    }

    function report(error: unknown) {
        const message = error instanceof Error ? error.message : 'Twitch connection failed.';
        dependencies.notify.showError(message);
    }

    function emit(event: TwitchEvent) {
        for (const listener of listeners) {
            listener(event);
        }
    }
}

type Lock = { release(): void };

const LOCK_FILE = 'twitch.lock';

function tryTakeLock(directory: string): Lock | undefined {
    fs.mkdirSync(directory, { recursive: true });
    const lockPath = path.join(directory, LOCK_FILE);
    try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(fd, String(process.pid));
        fs.closeSync(fd);
    } catch (error) {
        if (!isErrno(error, 'EEXIST')) {
            throw error;
        }
        if (isAlive(Number(fs.readFileSync(lockPath, 'utf8')))) {
            return undefined;
        }
        fs.unlinkSync(lockPath);
        return tryTakeLock(directory);
    }
    return {
        release() {
            try {
                fs.unlinkSync(lockPath);
            } catch (error) {
                if (!isErrno(error, 'ENOENT')) {
                    throw error;
                }
            }
        },
    };
}

function isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return isErrno(error, 'EPERM');
    }
}

function isErrno(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
