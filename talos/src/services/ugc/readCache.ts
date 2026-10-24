/** Short-lived point responses must release expired values as well as stop serving them. */
export class ReadCache<T extends { expiresAt: number }> extends Map<string, T> {
    override get(key: string): T | undefined {
        const value = super.get(key);
        if (!value) return undefined;
        if (value.expiresAt <= Date.now()) {
            this.delete(key);
            return undefined;
        }
        this.delete(key);
        super.set(key, value);
        return value;
    }

    override set(key: string, value: T): this {
        const now = Date.now();
        for (const [id, entry] of this) if (entry.expiresAt <= now) this.delete(id);
        this.delete(key);
        if (value.expiresAt <= now) return this;
        if (this.size >= 512) this.delete(this.keys().next().value!);
        return super.set(key, value);
    }
}
