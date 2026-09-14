export interface R2ObjectLike {
    text(): Promise<string>;
}

export interface R2BucketLike {
    get(key: string): Promise<R2ObjectLike | null>;
}

export interface Env {
    OEA_PACKAGES?: R2BucketLike;
}

export type DownloadHandler = (
    request: Request,
    env?: Env,
) => Promise<Response | null>;
