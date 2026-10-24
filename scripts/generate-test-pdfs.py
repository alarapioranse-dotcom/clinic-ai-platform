#!/usr/bin/env python3
"""Generates the synthetic PDF fixtures in tests/fixtures/pdfs/ (ADR-0026, Owner ruling F5).

Development only: CI and the test suite use the committed files and never run this script.
Every file is synthetic (no real clinic or patient data). Requirements: Python 3 with
reportlab, the DejaVu Sans font, qpdf, and LibreOffice (soffice) for the one fixture that has
to come from a real word processor.

    python3 scripts/generate-test-pdfs.py

reportlab's `invariant=1` keeps the reportlab output byte-stable between runs; the qpdf and
LibreOffice outputs are not guaranteed to be byte-identical across tool versions.
"""

import os
import shutil
import subprocess
import tempfile

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'pdfs')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

pdfmetrics.registerFont(TTFont('DejaVuSans', FONT))


def write(name, pages, font='DejaVuSans', size=12, link=False, line_height=20):
    c = canvas.Canvas(os.path.join(OUT, name), invariant=1, pageCompression=1)
    for lines in pages:
        c.setFont(font, size)
        y = 800
        for line in lines:
            c.drawString(40, y, line)
            y -= line_height
        if link:
            c.linkURL('https://tracker.example.invalid/pixel', (40, 600, 300, 620))
        c.showPage()
    c.save()


def main():
    os.makedirs(OUT, exist_ok=True)

    # Two paragraphs on page 1 (blank line between them), one on page 2; a line break inside
    # the first paragraph.
    write('english.pdf', [
        ['Opening hours: Monday to Friday,', '09:00 to 17:00.', '',
         'A dental cleaning costs 40 EUR.'],
        ['Cancellations need 24 hours notice.'],
    ])
    write('greek.pdf', [['Ωράριο λειτουργίας: Δευτέρα έως Παρασκευή.', '',
                         'Καθαρισμός δοντιών: 40 ευρώ.']])
    # Arabic presentation forms in visual order, as many right-to-left authoring tools emit.
    write('arabic-presentation-forms.pdf', [['ﺔﻌﻤﺠﻟﺍ ﻰﻟﺇ ﻦﻴﻨﺛﻻﺍ ﻦﻣ ﻞﻤﻌﻟﺍ ﺕﺎﻋﺎﺳ']])
    write('ligatures.pdf', [['ﬁle ﬂow']])
    write('standard-font.pdf', [['Standard font Helvetica text.']], font='Helvetica')
    write('embedded-link.pdf', [['Visit our website for directions.']], link=True)
    write('pages-100.pdf', [[f'Page {n} of the policy.'] for n in range(1, 101)])
    write('pages-101.pdf', [[f'Page {n} of the policy.'] for n in range(1, 102)])
    # Many paragraphs, for chunking across a real document.
    paragraphs = []
    for n in range(1, 41):
        paragraphs += [f'Section {n}. Patients should arrive ten minutes early for their visit.',
                       'Please bring a list of current medication and any previous x-rays.', '']
    write('many-paragraphs.pdf', [paragraphs[i:i + 36] for i in range(0, len(paragraphs), 36)])
    # A small file whose text is far over the 500,000 code-point limit: 600 lines of 150
    # characters on each of 6 pages (540,000 characters), compressed.
    line = 'All appointments are confirmed by email. ' * 4
    line = line[:150]
    write('high-text-ratio.pdf', [[line] * 600 for _ in range(6)], size=1, line_height=1.2)

    # Image-only page (a "scan"): no text layer.
    c = canvas.Canvas(os.path.join(OUT, 'scanned.pdf'), invariant=1)
    c.rect(40, 400, 400, 300, fill=1)
    c.showPage()
    c.save()
    # A blank page.
    c = canvas.Canvas(os.path.join(OUT, 'empty.pdf'), invariant=1)
    c.showPage()
    c.save()

    english = os.path.join(OUT, 'english.pdf')
    # Needs a password to open.
    subprocess.run(['qpdf', '--encrypt', 'synthetic-user', 'synthetic-owner', '256', '--',
                    english, os.path.join(OUT, 'encrypted-password.pdf')], check=True)
    # Encrypted, but opens without a password (owner password only).
    subprocess.run(['qpdf', '--encrypt', '', 'synthetic-owner', '256', '--',
                    english, os.path.join(OUT, 'encrypted-owner-only.pdf')], check=True)
    # A valid signature followed by a broken structure.
    with open(english, 'rb') as source:
        head = source.read(600)
    with open(os.path.join(OUT, 'truncated.pdf'), 'wb') as target:
        target.write(head)

    # Mixed Arabic and Greek through LibreOffice, the closest synthetic stand-in for a real
    # clinic document. Its Arabic extracts imperfectly (see the knowledge-base README).
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, 'libreoffice-arabic-greek.txt')
        with open(source, 'w', encoding='utf-8') as f:
            f.write('ساعات العمل من الاثنين إلى الجمعة، من التاسعة صباحاً.\n\n'
                    'تنظيف الأسنان: ٤٠ يورو.\n\n'
                    'Ωράριο: Δευτέρα–Παρασκευή.\n')
        subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', tmp, source],
                       check=True, capture_output=True)
        shutil.copy(os.path.join(tmp, 'libreoffice-arabic-greek.pdf'),
                    os.path.join(OUT, 'libreoffice-arabic-greek.pdf'))


if __name__ == '__main__':
    main()
