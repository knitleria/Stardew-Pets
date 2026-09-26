import type { DevicePoll, ManagedReward, TokenGrant, TwitchApi, TwitchSocket } from './connection';

const deviceUrl = 'https://id.twitch.tv/oauth2/device';
const tokenUrl = 'https://id.twitch.tv/oauth2/token';
const helixUrl = 'https://api.twitch.tv/helix';

export function createTwitchApi(): TwitchApi {
    return {
        async requestDeviceCode(clientId, scopes) {
            const payload = await postForm(deviceUrl, {
                client_id: clientId,
                scopes: scopes.join(' '),
            });
            if (!payload.ok) {
                throw new Error(text(payload.body) || 'Twitch did not start device authorization.');
            }
            return {
                deviceCode: stringField(payload.body, 'device_code'),
                userCode: stringField(payload.body, 'user_code'),
                verificationUri: stringField(payload.body, 'verification_uri'),
                intervalSeconds: numberField(payload.body, 'interval'),
                expiresInSeconds: numberField(payload.body, 'expires_in'),
            };
        },
        async pollDeviceCode(clientId, deviceCode) {
            const payload = await postForm(tokenUrl, {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            });
            if (payload.ok) {
                return { status: 'approved', tokens: tokenGrant(payload.body) };
            }
            return devicePollStatus(payload.body);
        },
        async refresh(clientId, refreshToken) {
            const payload = await postForm(tokenUrl, {
                client_id: clientId,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            });
            if (!payload.ok) {
                return { rejected: true };
            }
            return tokenGrant(payload.body);
        },
        async currentUser(clientId, accessToken) {
            const payload = await helix(clientId, accessToken, '/users');
            const id = firstDataId(payload);
            return { id };
        },
        async isStreamLive(clientId, accessToken, userId) {
            const payload = await helix(clientId, accessToken, `/streams?user_id=${encodeURIComponent(userId)}`);
            return dataArray(payload).length > 0;
        },
        async subscribe(input) {
            const payload = await helix(input.clientId, input.accessToken, '/eventsub/subscriptions', {
                method: 'POST',
                body: JSON.stringify({
                    type: input.type,
                    version: '1',
                    condition: { broadcaster_user_id: input.broadcasterUserId },
                    transport: { method: 'websocket', session_id: input.sessionId },
                }),
            });
            return { id: firstDataId(payload) };
        },
        async unsubscribe(input) {
            await helix(input.clientId, input.accessToken, `/eventsub/subscriptions?id=${encodeURIComponent(input.id)}`, {
                method: 'DELETE',
            });
        },
        async listRewards(input) {
            const payload = await helixStatus(
                input.clientId,
                input.accessToken,
                `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(input.broadcasterUserId)}`,
            );
            if (payload.status === 403) {
                return { forbidden: true as const };
            }
            if (!payload.ok) {
                throw new Error(text(payload.body) || `Twitch request failed (${payload.status}).`);
            }
            return { rewards: managedRewards(payload.body) };
        },
        async updateReward(input) {
            const body: Record<string, unknown> = {};
            if (input.cost !== undefined) {
                body.cost = input.cost;
            }
            if (input.prompt !== undefined) {
                body.prompt = input.prompt;
            }
            if (input.userInputRequired !== undefined) {
                body.is_user_input_required = input.userInputRequired;
            }
            if (input.isEnabled !== undefined) {
                body.is_enabled = input.isEnabled;
            }
            if (input.isPaused !== undefined) {
                body.is_paused = input.isPaused;
            }
            if (input.skipRequestQueue !== undefined) {
                body.should_redemptions_skip_request_queue = input.skipRequestQueue;
            }
            const payload = await helixStatus(
                input.clientId,
                input.accessToken,
                `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(input.broadcasterUserId)}&id=${encodeURIComponent(input.id)}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(body),
                },
            );
            if (payload.status === 403) {
                return { forbidden: true as const };
            }
            if (!payload.ok) {
                throw new Error(text(payload.body) || `Twitch request failed (${payload.status}).`);
            }
            return { ok: true as const };
        },
        async updateRedemption(input) {
            const payload = await helixStatus(
                input.clientId,
                input.accessToken,
                `/channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(input.broadcasterUserId)}&reward_id=${encodeURIComponent(input.rewardId)}&id=${encodeURIComponent(input.redemptionId)}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ status: input.status }),
                },
            );
            if (!payload.ok) {
                throw new Error(text(payload.body) || `Twitch request failed (${payload.status}).`);
            }
        },
    };
}

export function openTwitchSocket(url: string): TwitchSocket {
    const socket = new WebSocket(url);
    return {
        close() {
            socket.close();
        },
        onMessage(handler) {
            socket.addEventListener('message', event => {
                void messageText(event.data).then(handler);
            });
        },
        onClose(handler) {
            socket.addEventListener('close', () => {
                handler();
            });
        },
        onError(handler) {
            socket.addEventListener('error', () => {
                handler(new Error('Twitch socket error'));
            });
        },
    };
}

type Json = Record<string, unknown>;

async function postForm(url: string, fields: Record<string, string>) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
    });
    return { ok: response.ok, body: await readJson(response) };
}

async function helix(clientId: string, accessToken: string, path: string, init?: { method?: string; body?: string }) {
    const payload = await helixStatus(clientId, accessToken, path, init);
    if (!payload.ok) {
        throw new Error(text(payload.body) || `Twitch request failed (${payload.status}).`);
    }
    return payload.body;
}

async function helixStatus(clientId: string, accessToken: string, path: string, init?: { method?: string; body?: string }) {
    const response = await fetch(`${helixUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: init?.body,
    });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
}

async function readJson(response: Response): Promise<Json> {
    const raw = await response.text();
    if (raw === '') {
        return {};
    }
    return JSON.parse(raw) as Json;
}

function tokenGrant(body: Json): TokenGrant {
    return {
        accessToken: stringField(body, 'access_token'),
        refreshToken: stringField(body, 'refresh_token'),
        expiresInSeconds: numberField(body, 'expires_in'),
    };
}

function devicePollStatus(body: Json): DevicePoll {
    const detail = `${stringOrEmpty(body.error)} ${stringOrEmpty(body.message)}`.toLowerCase();
    if (detail.includes('authorization_pending') || detail.includes('authorization pending')) {
        return { status: 'pending' };
    }
    if (detail.includes('slow_down') || detail.includes('slow down')) {
        return { status: 'slow-down' };
    }
    if (detail.includes('expired')) {
        return { status: 'expired' };
    }
    return { status: 'denied' };
}

function firstDataId(body: Json): string {
    const row = dataArray(body)[0];
    if (row === undefined || typeof row.id !== 'string') {
        throw new Error('Twitch response did not include an id.');
    }
    return row.id;
}

function dataArray(body: Json): Json[] {
    if (!Array.isArray(body.data)) {
        return [];
    }
    return body.data.filter((row): row is Json => typeof row === 'object' && row !== null);
}

function managedRewards(body: Json): ManagedReward[] {
    return dataArray(body).flatMap(row => {
        if (typeof row.id !== 'string' || typeof row.title !== 'string') {
            return [];
        }
        return [{ id: row.id, title: row.title }];
    });
}

function stringField(body: Json, key: string): string {
    const value = body[key];
    if (typeof value !== 'string' || value === '') {
        throw new Error(`Twitch response did not include ${key}.`);
    }
    return value;
}

function numberField(body: Json, key: string): number {
    const value = body[key];
    if (typeof value !== 'number') {
        throw new Error(`Twitch response did not include ${key}.`);
    }
    return value;
}

function stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function text(body: Json): string {
    return stringOrEmpty(body.message);
}

async function messageText(data: unknown): Promise<string> {
    if (typeof data === 'string') {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return new TextDecoder().decode(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data);
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.text();
    }
    return '';
}
