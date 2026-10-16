import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
import generate


class ShardGenerationTest(unittest.TestCase):
    def test_glyph_packs_keep_names_together_and_merge_sparse_tails(self):
        layout = {'base': {'CN': 'A'}, 'labels': {'CN': ''.join(chr(0x4e00 + i) for i in range(750))},
                  'reading': {'CN': ''.join(chr(0x6000 + i) for i in range(900))},
                  'packing': {'target': 1024, 'minimum': 512, 'maximum': 1536}}
        coverage = {65} | set(range(0x4e00, 0x4e00 + 750)) | set(range(0x6000, 0x6000 + 900))
        # Widely separated codepoints must still fill real glyph-count packs.
        coverage.update(0x10000 + i * 30 for i in range(2200))
        groups = generate.partition(coverage, layout, 'CN')
        self.assertEqual(len(groups['labels']), 750)
        self.assertEqual(len(groups['reading']), 900)
        self.assertTrue(all(512 <= len(points) <= 1536 for key, points in groups.items() if key != 'base'))
        union = set()
        for points in groups.values():
            self.assertFalse(union & points)
            union.update(points)
        self.assertEqual(union, coverage)

    def test_real_subsets_cover_original_disjointly_and_keep_cached_urls(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / 'source.ttf'
            builder = FontBuilder(1000, isTTF=True)
            characters = {65: 'A', 0x4e00: 'one', 0x4e8c: 'two', 0x20000: 'extension'}
            order = ['.notdef', *characters.values()]
            builder.setupGlyphOrder(order)
            builder.setupCharacterMap(characters)
            builder.setupGlyf({name: TTGlyphPen(None).glyph() for name in order})
            builder.setupHorizontalMetrics({name: (500, 0) for name in order})
            builder.setupHorizontalHeader(ascent=800, descent=-200)
            builder.setupNameTable({'familyName': 'Test', 'styleName': 'Regular'})
            builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
            builder.setupPost()
            builder.save(source)
            layout = {'version': 'v1', 'packing': {'target': 1024, 'minimum': 512, 'maximum': 1536}, 'base': {'CN': 'A一'}}
            job = ('CN', 'r', layout, str(directory), 0)
            with patch.object(generate, 'source_path', return_value=source):
                _, _, parts = generate.build_face(job)
                coverage = set()
                for part in parts.values():
                    font = TTFont(directory / part['file'])
                    actual = set(font.getBestCmap())
                    self.assertFalse(coverage & actual)
                    coverage.update(actual)
                    font.close()
                self.assertEqual(coverage, set(characters))
                before = {part['file']: (directory / part['file']).read_bytes() for part in parts.values()}
                # No catalog input participates in regeneration or cache identity.
                self.assertEqual(generate.build_face(job)[2], parts)
                self.assertTrue(all((directory / file).read_bytes() == data for file, data in before.items()))
                layout['sources'] = {'CN-r': hashlib.sha256(b'changed').hexdigest()}
                with self.assertRaisesRegex(RuntimeError, 'Original font changed'):
                    generate.build_face(job)


if __name__ == '__main__':
    unittest.main()
