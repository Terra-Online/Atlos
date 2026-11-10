#!/usr/bin/env python3
"""Download selected files from the official client's split ZIP, without joining it.

Input is a locally supplied launcher response with
proxy_rsps[0].get_latest_game_rsp.pkg.packs (url and package_size per part).
No client URLs, keys or game content are bundled. Python 3.10+; standard library only.
"""

import argparse
import bisect
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import struct
import tempfile
import time
import urllib.request
import zipfile
import zlib

LOCAL = struct.Struct('<4s5H3L2H')
BLOCK = 8 * 1024 * 1024


def fetch_range(url, start, length):
    end = start + length - 1
    request = urllib.request.Request(url, headers={
        'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                content_range = response.headers.get('Content-Range', '')
                if response.status != 206 or not content_range.startswith(f'bytes {start}-{end}/'):
                    raise ValueError('server did not honor the requested byte range')
                data = response.read(length + 1)
                if len(data) != length:
                    raise ValueError('incomplete or oversized range response')
                return data
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


class SplitZip:
    def __init__(self, links, cache, index_bytes):
        manifest = links.read_bytes()
        self.packs = json.loads(manifest)['proxy_rsps'][0]['get_latest_game_rsp']['pkg']['packs']
        if not self.packs:
            raise ValueError('empty package manifest')
        self.starts = []
        total = 0
        for part in self.packs:
            size = int(part['package_size'])
            if size <= 0 or not part['url'].startswith(('https://', 'http://')):
                raise ValueError('invalid package size or URL')
            self.starts.append(total)
            total += size
        self.total = total
        self.cache = cache / hashlib.sha256(manifest).hexdigest()
        self.cache.mkdir(parents=True, exist_ok=True)
        final_size = int(self.packs[-1]['package_size'])
        take = min(final_size, index_bytes)
        index = self.cache / f'index-{take}.zip'
        if not index.exists():
            tail = fetch_range(self.packs[-1]['url'], final_size - take, take)
            with tempfile.NamedTemporaryFile(dir=self.cache, delete=False) as output:
                temporary = Path(output.name)
                try:
                    output.truncate(final_size)
                    output.seek(final_size - take)
                    output.write(tail)
                    output.close()
                    # Check the complete central directory before retaining the index.
                    with zipfile.ZipFile(temporary) as archive:
                        archive.infolist()
                    temporary.replace(index)
                finally:
                    temporary.unlink(missing_ok=True)
        self.archive = zipfile.ZipFile(index)

    def close(self):
        self.archive.close()

    def chunks(self, offset, length):
        if offset < 0 or length < 0 or offset + length > self.total:
            raise ValueError('range outside the archive')
        while length:
            part = bisect.bisect_right(self.starts, offset) - 1
            start = offset - self.starts[part]
            take = min(length, int(self.packs[part]['package_size']) - start, BLOCK)
            path = self.cache / f'{part}-{start}-{take}'
            if not path.exists() or path.stat().st_size != take:
                data = fetch_range(self.packs[part]['url'], start, take)
                with tempfile.NamedTemporaryFile(dir=self.cache, delete=False) as output:
                    temporary = Path(output.name)
                    try:
                        output.write(data)
                        output.close()
                        temporary.replace(path)
                    finally:
                        temporary.unlink(missing_ok=True)
            yield path.read_bytes()
            offset += take
            length -= take

    def select(self, name):
        files = [entry for entry in self.archive.infolist() if not entry.is_dir()]
        exact = [entry for entry in files if entry.filename == name]
        matches = exact or [entry for entry in files if entry.filename.endswith('/' + name)]
        if len(matches) != 1:
            raise ValueError(f'{name}: expected one file, found {len(matches)}; use --list')
        return matches[0]

    def extract(self, entry, root):
        name = PurePosixPath(entry.filename)
        if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or ':' in entry.filename:
            raise ValueError('unsafe archive path')
        root = root.resolve()
        destination = root.joinpath(*name.parts)
        # Reject symlinks as well as lexical traversal, including broken symlinks.
        for path in (destination, *destination.parents):
            if path.is_symlink():
                raise ValueError('output path contains a symlink')
            if path == root:
                break
        if destination.exists():
            crc = 0
            with destination.open('rb') as source:
                while data := source.read(BLOCK):
                    crc = zlib.crc32(data, crc)
            if destination.stat().st_size == entry.file_size and crc & 0xffffffff == entry.CRC:
                print(f'already verified: {entry.filename}')
                return
            raise ValueError(f'refusing to replace mismatched file: {destination}')
        offset = self.starts[-1] + entry.header_offset
        header = b''.join(self.chunks(offset, LOCAL.size))
        signature, _, flags, method, _, _, _, size, raw_size, name_len, extra_len = LOCAL.unpack(header)
        if signature != b'PK\x03\x04' or flags & 9 or method not in (0, 8):
            raise ValueError('unsupported ZIP header, encryption, descriptor or compression')
        if size == 0xffffffff or raw_size == 0xffffffff:
            raise ValueError('ZIP64 local entries are unsupported')
        if size != entry.compress_size or raw_size != entry.file_size:
            raise ValueError('local and central ZIP sizes disagree')
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            try:
                decoder = zlib.decompressobj(-15) if method == 8 else None
                crc = count = 0

                def write(data):
                    nonlocal crc, count
                    count += len(data)
                    if count > entry.file_size:
                        raise ValueError('decompressed file exceeds declared size')
                    crc = zlib.crc32(data, crc)
                    output.write(data)

                for compressed in self.chunks(offset + LOCAL.size + name_len + extra_len, size):
                    if decoder is None:
                        write(compressed)
                    else:
                        # Bound memory even for highly compressible entries.
                        while compressed:
                            write(decoder.decompress(compressed, BLOCK))
                            compressed = decoder.unconsumed_tail
                if decoder is not None:
                    write(decoder.flush())
                    if not decoder.eof or decoder.unused_data:
                        raise ValueError('invalid deflate stream')
                if count != entry.file_size or crc & 0xffffffff != entry.CRC:
                    raise ValueError('file size or CRC mismatch; remove its cached ranges and retry')
                output.close()
                # Atomic no-clobber publication; never replace an existing install file.
                os.link(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
        print(f'{entry.filename}\t{count} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--links', type=Path, required=True, help='local launcher package response JSON')
    parser.add_argument('--out', type=Path, help='install root, preserving archive-relative paths')
    parser.add_argument('--cache', type=Path, default=Path('out/download-cache'))
    parser.add_argument('--index-bytes', type=int, default=BLOCK, help='tail bytes containing the central directory')
    parser.add_argument('--list', action='store_true', help='list archive file paths without extracting')
    parser.add_argument('--file-list', type=Path, help='UTF-8 file with one archive path per line')
    parser.add_argument('names', nargs='*', help='exact paths or unique path suffixes')
    args = parser.parse_args()
    names = args.names + (args.file_list.read_text(encoding='utf-8').splitlines() if args.file_list else [])
    names = list(dict.fromkeys(name for name in names if name))
    if args.index_bytes <= 0 or (not args.list and (not args.out or not names)):
        parser.error('supply --out and file names (or --file-list), or use --list; index bytes must be positive')
    archive = SplitZip(args.links, args.cache, args.index_bytes)
    try:
        if args.list:
            for entry in archive.archive.infolist():
                if not entry.is_dir():
                    print(entry.filename)
        else:
            entries = [archive.select(name) for name in names]
            for entry in entries:
                archive.extract(entry, args.out)
    finally:
        archive.close()


if __name__ == '__main__':
    main()
