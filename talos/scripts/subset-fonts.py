#!/usr/bin/env python3
"""Compatibility entry point for the shared immutable font generator."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/fonts'))
from generate import main

if __name__ == '__main__':
    main()
