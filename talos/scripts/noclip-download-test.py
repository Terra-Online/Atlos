"""Offline regression checks for split archive downloads. Run with Python 3.10+."""

import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('downloader', Path(__file__).with_name('noclip-download.py'))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)


class Downloads(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        content = io.BytesIO()
        self.payload = bytes(range(256)) * 200
        with zipfile.ZipFile(content, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('Endfield_Data/StreamingAssets/VFS/group/test.chk', self.payload)
            archive.writestr('../escape.chk', b'bad')
        data = content.getvalue()
        # The compressed payload crosses part boundaries; central directory is in the final part.
        self.parts = [data[:40], data[40:100], data[100:]]
        self.links = self.root / 'links.json'
        self.links.write_text(json.dumps({'proxy_rsps': [{'get_latest_game_rsp': {'pkg': {
            'packs': [{'url': f'https://example.test/{i}', 'package_size': len(part)}
                      for i, part in enumerate(self.parts)],
        }}}]}))

    def ranges(self, url, start, length):
        return self.parts[int(url.rsplit('/', 1)[1])][start:start + length]

    def test_split_extract_resume_and_refuse_overwrite(self):
        with patch.object(downloader, 'fetch_range', side_effect=self.ranges):
            archive = downloader.SplitZip(self.links, self.root / 'cache', downloader.BLOCK)
            self.addCleanup(archive.close)
            entry = archive.select('test.chk')
            archive.extract(entry, self.root / 'install')
            output = self.root / 'install' / entry.filename
            self.assertEqual(output.read_bytes(), self.payload)
            with patch.object(downloader, 'fetch_range', side_effect=AssertionError('unexpected network')):
                archive.extract(entry, self.root / 'install')
            output.write_bytes(b'keep existing data')
            with self.assertRaisesRegex(ValueError, 'refusing to replace'):
                archive.extract(entry, self.root / 'install')
            self.assertEqual(output.read_bytes(), b'keep existing data')
            with self.assertRaisesRegex(ValueError, 'unsafe archive path'):
                archive.extract(archive.select('escape.chk'), self.root / 'install')
            self.assertFalse((self.root / 'escape.chk').exists())

    def test_corrupt_payload_never_published(self):
        with patch.object(downloader, 'fetch_range', side_effect=self.ranges):
            archive = downloader.SplitZip(self.links, self.root / 'cache', downloader.BLOCK)
            self.addCleanup(archive.close)
            entry = archive.select('test.chk')
            entry.CRC ^= 1
            with self.assertRaisesRegex(ValueError, 'CRC mismatch'):
                archive.extract(entry, self.root / 'install')
            self.assertFalse((self.root / 'install' / entry.filename).exists())

    def test_server_ignoring_range_is_rejected(self):
        response = io.BytesIO(b'full archive')
        response.status = 200
        response.headers = {}
        with patch.object(downloader.urllib.request, 'urlopen', return_value=response), \
                patch.object(downloader.time, 'sleep'):
            with self.assertRaises(ValueError):
                downloader.fetch_range('https://example.test/0', 2, 3)


if __name__ == '__main__':
    unittest.main()
