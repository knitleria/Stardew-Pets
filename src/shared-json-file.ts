import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type Disposable = {
    dispose(): void;
};

export type SharedJsonFileOptions = {
    watchIntervalMs?: number;
    lockTimeoutMs?: number;
};

export class SharedJsonFile<T> {
    private value: T;
    private readonly filePath: string;
    private readonly lockPath: string;
    private readonly parse: (text: string) => T;
    private readonly serialize: (value: T) => string;
    private readonly watchIntervalMs: number;
    private readonly lockTimeoutMs: number;
    private readonly listeners = new Set<(next: T, previous: T) => void>();
    private watching = false;
    private serialized: string;

    constructor(
        filePath: string,
        parse: (text: string) => T,
        serialize: (value: T) => string,
        options: SharedJsonFileOptions = {},
    ) {
        this.filePath = filePath;
        this.lockPath = `${filePath}.lock`;
        this.parse = parse;
        this.serialize = serialize;
        this.watchIntervalMs = options.watchIntervalMs ?? 100;
        this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
        this.serialized = fs.readFileSync(this.filePath, 'utf8');
        this.value = this.parse(this.serialized);
    }

    current(): T {
        return structuredClone(this.value);
    }

    reload(): T {
        this.serialized = fs.readFileSync(this.filePath, 'utf8');
        this.value = this.parse(this.serialized);
        return this.current();
    }

    update(change: (latest: T) => T): T {
        const previous = this.current();
        let external: T | undefined;
        const next = this.withLock(() => {
            const latestSerialized = fs.readFileSync(this.filePath, 'utf8');
            const latest = this.parse(latestSerialized);
            if (latestSerialized !== this.serialized) {
                external = structuredClone(latest);
            }
            const changed = change(structuredClone(latest));
            const serialized = this.serialize(changed);
            const temporaryPath = path.join(
                path.dirname(this.filePath),
                `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
            );
            try {
                fs.writeFileSync(temporaryPath, serialized);
                fs.renameSync(temporaryPath, this.filePath);
            } finally {
                if (fs.existsSync(temporaryPath)) {
                    fs.unlinkSync(temporaryPath);
                }
            }
            this.serialized = serialized;
            return changed;
        });
        this.value = next;
        if (external !== undefined) {
            for (const listener of this.listeners) {
                listener(structuredClone(external), previous);
            }
        }
        return this.current();
    }

    onDidChange(listener: (next: T, previous: T) => void): Disposable {
        this.listeners.add(listener);
        this.startWatching();
        return {
            dispose: () => {
                this.listeners.delete(listener);
                if (this.listeners.size === 0) {
                    this.stopWatching();
                }
            },
        };
    }

    dispose(): void {
        this.listeners.clear();
        this.stopWatching();
    }

    private startWatching(): void {
        if (this.watching) {
            return;
        }
        this.watching = true;
        fs.watchFile(this.filePath, { interval: this.watchIntervalMs, persistent: false }, this.handleFileChange);
    }

    private stopWatching(): void {
        if (!this.watching) {
            return;
        }
        fs.unwatchFile(this.filePath, this.handleFileChange);
        this.watching = false;
    }

    private readonly handleFileChange = () => {
        let serialized: string;
        try {
            serialized = fs.readFileSync(this.filePath, 'utf8');
        } catch {
            return;
        }
        if (serialized === this.serialized) {
            return;
        }
        let next: T;
        try {
            next = this.parse(serialized);
        } catch {
            return;
        }
        const previous = this.current();
        this.serialized = serialized;
        this.value = next;
        for (const listener of this.listeners) {
            listener(structuredClone(next), previous);
        }
    };

    private withLock<R>(action: () => R): R {
        const startedAt = Date.now();
        let lock: number | undefined;
        while (lock === undefined) {
            try {
                lock = fs.openSync(this.lockPath, 'wx');
                fs.writeFileSync(lock, String(process.pid));
            } catch (error) {
                if (!isAlreadyExists(error) || Date.now() - startedAt >= this.lockTimeoutMs) {
                    throw error;
                }
                if (!this.lockOwnerIsAlive()) {
                    try {
                        fs.unlinkSync(this.lockPath);
                    } catch (unlinkError) {
                        if (!isMissing(unlinkError)) {
                            throw unlinkError;
                        }
                    }
                    continue;
                }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
        }
        try {
            return action();
        } finally {
            fs.closeSync(lock);
            try {
                fs.unlinkSync(this.lockPath);
            } catch (error) {
                if (!isMissing(error)) {
                    throw error;
                }
            }
        }
    }

    private lockOwnerIsAlive(): boolean {
        let pid: number;
        try {
            pid = Number(fs.readFileSync(this.lockPath, 'utf8'));
        } catch {
            return false;
        }
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
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
