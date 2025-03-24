from PIL import Image
from PIL import ImageFile
import argparse
import os
import pathlib
import tqdm

ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

def split_image(image_path, zoom_level, output_format='webp'):
    # Get input file information
    file_name = pathlib.Path(image_path).stem
    file_extension = pathlib.Path(image_path).suffix.lower()

    print(f'To process: {image_path}')
    print(f'Input format: {file_extension}, Output format: {output_format}')

    image = Image.open(image_path)
    width, height = image.size
    print(f'Size: {width}x{height}px')

    unit_size = 500

    output_folder = f'{zoom_level}'
    os.makedirs(output_folder, exist_ok=True)

    x_units = width // unit_size
    y_units = height // unit_size

    total_tiles = x_units * y_units
    saved_tiles = 0

    coordinates = [(x, y) for x in range(x_units) for y in range(y_units)]

    # Use tqdm to create progress bar
    with tqdm.tqdm(total=total_tiles, desc="Processing tiles") as pbar:
        for x, y in coordinates:
            left = x * unit_size
            upper = y * unit_size
            right = min(left + unit_size, width)
            lower = min(upper + unit_size, height)

            box = (left, upper, right, lower)
            tile = image.crop(box)

            # Create a new image with transparent background
            new_tile = Image.new('RGBA', (unit_size, unit_size), (0, 0, 0, 0))
            new_tile.paste(tile, (0, 0))

            # Check if the tile is completely transparent
            if new_tile.getbbox() is None:
                pbar.update(1)
                continue

            # Save according to the specified format
            if output_format.lower() == 'avif':
                tile_path = os.path.join(output_folder, f'{x}_{y}.avif')
                new_tile.save(tile_path, 'AVIF', quality=80)
            else:
                tile_path = os.path.join(output_folder, f'{x}_{y}.webp')
                new_tile.save(tile_path, 'WEBP', quality=80)

            saved_tiles += 1
            pbar.update(1)
            # Update progress bar description
            pbar.set_description(f"Processing tiles ({saved_tiles} saved)")

    print(f'Split! Go and see: {output_folder}')
    print(f'{total_tiles} chunks processed, {saved_tiles} non-empty chunks saved')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Split image into WebP or AVIF format tiles')
    parser.add_argument('image_path', type=str, help='Input image path (supports PNG and other formats)')
    parser.add_argument('zoom_level', type=int, help='Zoom level')
    parser.add_argument('--format', '-f', type=str, choices=['webp', 'avif'],
                        default='webp', help='Output format: webp or avif (default: webp)')
    args = parser.parse_args()

    split_image(args.image_path, args.zoom_level, args.format)