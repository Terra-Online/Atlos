"""Cache boundary tests; real font/OG byte comparisons accompany release checks."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import subset_fonts as pipeline


class FontCacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.originals = self.root / 'originals'
        self.originals.mkdir()
        self.source = self.originals / 'Test.ttf'
        self.source.write_bytes(b'original font')
        self.output = self.root / 'fonts'
        self.patchers = [
            patch.object(pipeline, 'PROJECT_ROOT', self.root),
            patch.object(pipeline, 'ORIGINAL_FONTS_DIR', self.originals),
            patch.object(pipeline, 'convert_to_woff2', side_effect=self.convert),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.conversions = 0

    def convert(self, source, output, characters):
        self.conversions += 1
        output.write_bytes(source.read_bytes() + ''.join(sorted(characters)).encode())

    def generate(self, characters='abc'):
        pipeline.process_font('Test.ttf', set(characters), lambda _: None,
                              self.output, formats=('woff2',))

    def test_reuses_outputs_and_invalidates_changed_inputs(self):
        self.generate()
        self.generate()
        self.assertEqual(self.conversions, 1)
        self.generate('abcd')
        self.assertEqual(self.conversions, 2)
        self.source.write_bytes(b'replaced font')
        self.generate('abcd')
        self.assertEqual(self.conversions, 3)
        self.assertEqual(sorted(p.name for p in self.output.iterdir()), ['Test.woff2'])

    def test_repairs_missing_corrupt_outputs_and_corrupt_cache(self):
        self.generate()
        font = self.output / 'Test.woff2'
        font.unlink()
        self.generate()
        font.write_bytes(b'corrupt')
        self.generate()
        cache = next((self.root / '.cache/fonts').glob('*.json'))
        cache.write_text('invalid json')
        self.generate()
        self.assertEqual(self.conversions, 4)
        self.assertEqual(font.read_bytes(), b'original fontabc')


if __name__ == '__main__':
    unittest.main()
