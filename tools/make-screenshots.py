#!/usr/bin/env python3
"""
Render Chrome Web Store screenshots at 1280x800.

Drawn from the same tokens as src/popup.css rather than photographed, so the UI in the
listing cannot drift from the UI that ships. The "video" behind it is a neutral mock — a
real YouTube frame would put someone else's copyrighted material in the listing.

    python3 tools/make-screenshots.py     ->  dist/screenshot-N-*.png
"""

import subprocess
from pathlib import Path

W, H = 1280, 800

BG      = '#0D1014'
CARD    = '#161B22'
LINE    = '#262D36'
TEXT    = '#E6EAEF'
DIM     = '#8A94A2'
ACCENT  = '#FB923C'
GREEN   = '#4ADE80'

SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif'
MONO = 'Menlo, Monaco, monospace'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text(x, y, s, size=14, fill=TEXT, weight='400', family=SANS, anchor='start', opacity=1):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}" opacity="{opacity}">{esc(s)}</text>')


def rect(x, y, w, h, fill='none', stroke=None, rx=0, sw=1, opacity=1):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{st} opacity="{opacity}"/>'


def browser_chrome(badge=None):
    """A slim toolbar so the popup reads as a popup rather than a floating panel."""
    out = [rect(0, 0, W, 56, fill='#1B2027'), rect(0, 55, W, 1, fill='#000', opacity=.4)]
    for i, c in enumerate(['#2B313A'] * 3):
        out.append(f'<circle cx="{28 + i*22}" cy="28" r="6" fill="{c}"/>')
    out += [rect(110, 14, 900, 28, fill='#0F1319', rx=14),
            text(128, 33, 'a-karaoke-site.example/watch', 13, DIM)]
    # The extension icon, pinned, with its badge.
    out.append(rect(1176, 14, 28, 28, fill='#12161C', rx=7))
    out.append(f'<path d="M1190 19 L1197 27 H1183 Z" fill="{ACCENT}"/>')
    out.append(rect(1183, 29, 14, 2.5, fill='#4B5563', rx=1.2))
    out.append(f'<path d="M1190 37 L1183 30 H1197 Z" fill="{ACCENT}"/>')
    if badge:
        out.append(rect(1197, 32, 20, 14, fill='#C2410C', rx=3.5))
        out.append(text(1207, 43, badge, 10.5, '#fff', '700', MONO, 'middle'))
    return out


def stage(lyric_lines, highlight=1, cx=W // 2):
    """Neutral karaoke frame: a lyric card, no third-party branding."""
    out = [rect(0, 56, W, H - 56, fill='#07090C')]
    out.append(f'''<defs><radialGradient id="glow" cx="50%" cy="45%" r="65%">
        <stop offset="0%" stop-color="#16202B"/><stop offset="100%" stop-color="#07090C"/>
      </radialGradient></defs>''')
    out.append(rect(0, 56, W, H - 56, fill='url(#glow)'))
    y = 330
    for i, line in enumerate(lyric_lines):
        on = i == highlight
        out.append(text(cx, y, line, 38 if on else 32, ACCENT if on else '#5B6672',
                        '700' if on else '600', SANS, 'middle'))
        y += 62
    return out


def hud(x, y, key, title, sub, big=False):
    """The on-screen readout, matching the shadow-DOM card in content.js."""
    pad, ks, ts, ss = (26, 54, 20, 14) if big else (16, 30, 15, 12)
    w = (330 if big else 250)
    h = (98 if big else 66)
    out = [rect(x, y, w, h, fill='#0C0E14', stroke='#3A414D', rx=13, sw=1.4, opacity=.97)]
    out.append(text(x + pad, y + h / 2 + ks / 3, key, ks, ACCENT if key != '0' else '#9CA3AF',
                    '700', MONO))
    tx = x + pad + (78 if big else 52)
    out.append(text(tx, y + h / 2 - 4, title, ts, TEXT, '600'))
    out.append(text(tx, y + h / 2 + (20 if big else 15), sub, ss, DIM))
    return out


def popup(x, y, key, key_label, remember_on=False, launcher_line=None):
    """Faithful to src/popup.html at 1.35x, so it is legible in a store thumbnail."""
    s = 1.35
    w = int(320 * s)
    h = 396 if launcher_line else 370
    out = [rect(x - 6, y - 6, w + 12, h + 12, fill='#000', rx=18, opacity=.45),
           rect(x, y, w, h, fill=BG, rx=14, stroke=LINE, sw=1)]

    p = int(16 * s)
    cx = x + p
    cw = w - 2 * p

    # key row
    bs = int(64 * s)
    out += [rect(cx, y + p, bs, bs, fill=CARD, stroke=LINE, rx=12),
            text(cx + bs / 2, y + p + bs / 2 + 12, '−', 34, TEXT, '600', SANS, 'middle')]
    out += [rect(x + w - p - bs, y + p, bs, bs, fill=CARD, stroke=LINE, rx=12),
            text(x + w - p - bs / 2, y + p + bs / 2 + 12, '+', 34, TEXT, '600', SANS, 'middle')]
    mid = x + w / 2
    out.append(text(mid, y + p + 56, key, 62, ACCENT if key != '0' else DIM, '700', SANS, 'middle'))
    out.append(text(mid, y + p + 80, key_label, 16, DIM, '400', SANS, 'middle'))

    ry = y + p + bs + 22
    out += [rect(cx, ry, cw, 46, fill='none', stroke=LINE, rx=10),
            text(mid, ry + 30, 'Reset to original key', 17, TEXT, '500', SANS, 'middle')]

    ry += 62
    fill = 'rgba(74,222,128,.07)' if remember_on else CARD
    stroke = 'rgba(74,222,128,.35)' if remember_on else LINE
    out += [rect(cx, ry, cw, 62, fill=fill, stroke=stroke, rx=12),
            f'<circle cx="{cx + 22}" cy="{ry + 31}" r="6" fill="{GREEN if remember_on else DIM}"/>',
            text(cx + 42, ry + 26, 'Remember keys per video', 15, TEXT, '600'),
            text(cx + 42, ry + 47,
                 'On · 3 videos remembered' if remember_on else 'Off · every video starts in its original key',
                 12.5, DIM)]
    bw = 74
    out += [rect(x + w - p - bw, ry + 17, bw, 28, fill='none', stroke=LINE, rx=7),
            text(x + w - p - bw / 2, ry + 36, 'Turn on' if not remember_on else 'Turn off', 13, TEXT,
                 '500', SANS, 'middle')]

    ry += 80
    if launcher_line:
        out.append(text(cx, ry, launcher_line, 13, DIM))
        ry += 26

    out.append(rect(cx, ry, cw, 1, fill=LINE))
    ry += 26
    out.append(text(cx, ry, '▸ Fine tune & display', 14, DIM))

    ry += 34
    keys = ['Alt', '+', 'Shift', '+', '↑', 'up', '·', 'Alt', '+', 'Shift', '+', '↓', 'down']
    kx = cx
    for k in keys:
        if k in ('+', '·', 'up', 'down'):
            out.append(text(kx, ry, k, 12.5, DIM))
            kx += 10 if k in ('+', '·') else 30
        else:
            bw2 = 16 + len(k) * 7
            out += [rect(kx, ry - 12, bw2, 18, fill=CARD, stroke=LINE, rx=4),
                    text(kx + bw2 / 2, ry + 1, k, 11, DIM, '400', MONO, 'middle')]
            kx += bw2 + 5
    return out


def render(name, body, caption=None, sub=None):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
             rect(0, 0, W, H, fill=BG)]
    parts += body
    if caption:
        parts.append(rect(0, H - 104, W, 104, fill='#000', opacity=.55))
        parts.append(text(W // 2, H - 62, caption, 27, TEXT, '700', SANS, 'middle'))
        if sub:
            parts.append(text(W // 2, H - 32, sub, 16, DIM, '400', SANS, 'middle'))
    parts.append('</svg>')

    out = Path('dist')
    out.mkdir(exist_ok=True)
    svg, png = out / f'{name}.svg', out / f'{name}.png'
    svg.write_text('\n'.join(parts), encoding='utf8')
    # rgb24: the store rejects alpha channels.
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(svg),
                    '-vf', f'scale={W}:{H}', '-pix_fmt', 'rgb24', str(png)], check=True)
    svg.unlink()
    print(f'  {png}')


print('rendering 1280x800, 24-bit, no alpha:')

render('screenshot-1-key',
       browser_chrome(badge='−2')
       + stage(['the line before', 'the line being sung', 'and the one after'], highlight=1, cx=390)
       + hud(60, 92, '−2', '2 semitones down', 'Semitone')
       + popup(760, 90, '−2', '2 semitones down', launcher_line='4 songs set by your setlist app.'),
       'Change the key while the track plays',
       'Three semitones either way, with the singer already on stage')

render('screenshot-2-stage',
       browser_chrome(badge='−2')
       + stage(['the line before', 'the line being sung', 'and the one after'], highlight=1)
       + hud(W // 2 - 165, 110, '−2', 'Slot 7 · Ana', '2 semitones down', big=True),
       'The key is on the screen everyone is watching',
       'Stage mode paints it on the page, not just in the toolbar')

render('screenshot-3-reset',
       browser_chrome()
       + stage(['a new song starts', 'in its own key', 'nothing carried over'], highlight=0, cx=390)
       + hud(60, 92, '0', 'Original key', 'Reset — new track')
       + popup(760, 90, '0', 'Original key', launcher_line='4 songs set by your setlist app.'),
       'It clears itself between songs',
       'No key ever carries from one singer to the next')
