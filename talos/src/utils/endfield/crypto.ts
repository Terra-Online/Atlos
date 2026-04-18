import md5 from 'blueimp-md5';

const textEncoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        {
            name: 'HMAC',
            hash: 'SHA-256',
        },
        false,
        ['sign'],
    );

    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        textEncoder.encode(message),
    );

    return toHex(new Uint8Array(signature));
}

export async function getSignature(
    path: string,
    timestamp: string,
    token: string,
    body = '',
): Promise<string> {
    const headerJson = JSON.stringify({
        platform: '3',
        timestamp,
        dId: '',
        vName: '1.0.0',
    });

    const str = path + body + timestamp + headerJson;
    const hmacHex = await hmacSha256Hex(str, token);
    return md5(hmacHex);
}
