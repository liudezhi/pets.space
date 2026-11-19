"""Photograph the production 3D garden with reproducible absolute camera poses.

Requires project dependencies (npm ci), Python Playwright and Chromium.
Run once with the original sources and once with the updated sources:

python3 scripts/capture-scenes.py --site /tmp/baseline --out /tmp/before
python3 scripts/capture-scenes.py --site . --rig /tmp/before/rig.json --out /tmp/after

Use the same Chromium binary, viewport, DPR and quality for a performance pair:

python3 scripts/capture-scenes.py --site /tmp/baseline --measure-only --quality fine --out /tmp/before-fine
python3 scripts/capture-scenes.py --site . --measure-only --quality fine --out /tmp/after-fine

Repeat with low for the lightweight preset or auto for a deterministic slow-input
scenario. 24 equally spaced W-key updates move 22.8 world units. Browser wall
time and synchronous pixel readback measure completed GPU frames. The 250 ms
input clock controls positions and automatic quality, independently of GPU speed.
Use --idle-only to count actual renders during reduced-motion idle and test wake.

Omit --rig to capture the selected version's actual default arrival positions.
--site can be a git archive with its own node_modules or a matching lockfile
and a linked dependency directory. Light and animation timing do not rely on
today's date. Timing results with software rendering describe this host only.
"""

import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import sync_playwright

SCRIPTS = Path(__file__).resolve().parent
WIDTH, HEIGHT = 1280, 720
TIMES = {
    'day': '2026-09-23T15:45:00+08:00', 'sunset': '2026-09-23T17:45:00+08:00',
    'night': '2026-09-23T23:00:00+08:00',
}
HTML = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,">
<title>栖光谷 · 固定机位</title><body style="margin:0"><main style="position:relative"></main>
<script src="camera.js"></script></body></html>'''
# Wrap only walk.js's renderer. The actual lights, scene, material settings,
# frame method, camera projection, render target and display transform come
# from the checked-out release, including any production shadow settings.
BUILD = r"""
import {build} from 'vite';
import {fileURLToPath} from 'node:url';
const [cameraFile, outDir] = process.argv.slice(1);
const three = fileURLToPath(import.meta.resolve('three'));
const shim = '\0fixed-camera-three';
const capturePlugin = {
  name: 'fixed-camera-renderer',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id !== 'three') return;
    return importer?.endsWith('/src/walk.js') ? shim : three;
  },
  load(id) {
    if (id !== shim) return;
    return `export * from 'three';
      import {WebGLRenderer as Renderer} from 'three';
      export class WebGLRenderer extends Renderer {
        constructor(...args) {
          super(...args);
          const probe = window.cameraProbe = {renderer: this, renderCount: 0};
          const render = this.render.bind(this);
          this.render = (scene, camera) => {
            probe.camera = camera;
            probe.renderCount++;
            const shot = probe.override;
            if (shot) {
              camera.position.fromArray(shot.position);
              camera.rotation.set(shot.pitch, shot.yaw, 0, 'YXZ');
              camera.fov = shot.fov;
              camera.updateProjectionMatrix();
            }
            return render(scene, camera);
          };
          this.setAnimationLoop = callback => { probe.frame = callback; };
        }
      }`;
  },
};
await build({
  configFile: false, logLevel: 'warn', plugins: [capturePlugin],
  build: {outDir, emptyOutDir: false, lib: {
    entry: cameraFile, name: 'CameraTool', formats: ['iife'], fileName: () => 'camera.js',
  }},
});
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def compare_routes(before, after):
    for key in ['width', 'height', 'chromium', 'renderer']:
        if before[key] != after[key]:
            raise ValueError('Different test conditions: ' + key)
    old, new = before['benchmark'], after['benchmark']
    for key in ['method', 'quality', 'logicalStepMs', 'warmupWalkingFrames', 'movingAnimation']:
        if old[key] != new[key]:
            raise ValueError('Different route conditions: ' + key)
    previous, current = old['walking'], new['walking']
    old_frames, new_frames = previous['samples'], current['samples']
    if (previous['start'] != current['start'] or previous['yaw'] != current['yaw'] or
            [f['position'] for f in old_frames] != [f['position'] for f in new_frames]):
        raise ValueError('Movement samples do not follow the same world coordinates.')
    same_buffers = [f['buffer'] for f in old_frames] == [f['buffer'] for f in new_frames]
    comparison = {'sameRoute': True, 'sameDrawingBuffers': same_buffers}
    if same_buffers:
        comparison['completedFpsRatio'] = round(current['completedFps'] / previous['completedFps'], 3)
    return comparison


def prepare_family_fixture(root, photo):
    # Serve fictitious family records solely from the temporary local camera host.
    # Real HTTP routes and all JavaScript that renders the member photos stay intact.
    second_photo = 'camera-family-photo' + photo.suffix.lower()
    shutil.copyfile(photo, root / second_photo)
    api = root / 'api' / 'courtyards'
    api.mkdir(parents=True)
    save_json(api / 'camera-family', {
        'courtyard': {'id': 'camera-family', 'name': '取景示例家庭'},
        'gardens': [
            {'name': '麦子', 'place': 'stone', 'photoUrl': '/pet.webp'},
            {'name': '团子', 'place': 'entrance', 'photoUrl': '/' + second_photo},
        ],
    })


def capture(args, url):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=args.chromium, headless=True,
            args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        )
        page = browser.new_page(
            viewport={'width': args.width, 'height': args.height},
            device_scale_factor=1, timezone_id='Asia/Shanghai',
        )
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda event: print(event.text, flush=True) if event.text.startswith('BENCH ') else None)
        page.on('console', lambda event: errors.append(event.text) if event.type == 'error' else None)
        page.goto(url, wait_until='networkidle')
        config = {
            'width': args.width, 'height': args.height, 'instant': TIMES['day'],
            'rig': json.loads(args.rig.read_text()) if args.rig else None,
            'family': bool(args.family_photo),
        }
        # Put a finite timeout on texture/portrait readiness inside Chromium.
        result = page.evaluate('''config => Promise.race([
            CameraTool.photograph(config),
            new Promise((_, reject) => setTimeout(() => reject(Error('Camera setup timed out')), 60000)),
        ])''', config)
        shots = [shot for shot in result['shots'] if not args.place or shot['name'] == args.place]
        if not shots:
            raise ValueError('Requested landmark was absent from the rig.')
        save_json(args.out / 'rig.json', shots)
        times = {key: TIMES[key] for key in (args.time or ['day', 'sunset'])}
        for shot in ([] if args.measure_only else shots):
            for label, instant in times.items():
                raw = page.evaluate('([shot, instant]) => captureFrame(shot, instant)', [shot, instant])
                destination = args.out / (shot['name'] + '-' + label + '.png')
                destination.write_bytes(base64.b64decode(raw))
                print(destination, flush=True)
        report = {
            'width': args.width, 'height': args.height, 'renderer': result['gpu'], 'chromium': browser.version,
            'times': times, 'season': 'autumn', 'weather': 'clear', 'animationSeconds': 0,
            'shadowMap': result['shadowMap'], 'errors': errors,
            'sampleFamilyMembers': 2 if args.family_photo else 0,
        }
        if args.benchmark:
            key = {'idle': 'reducedMotion', 'restore': 'restoration', 'natural': 'naturalMotion',
                   'route': 'benchmark'}[args.scenario]
            report[key] = page.evaluate('args => benchmarkScene(...args)', [args.quality, args.scenario])
        if args.compare:
            report['comparison'] = compare_routes(json.loads(args.compare.read_text()), report)
        save_json(args.out / 'capture.json', report)
        if errors:
            raise RuntimeError(errors)
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--rig', type=Path)
    parser.add_argument('--time', choices=TIMES, action='append', help='Exposure to include. Defaults to day and sunset.')
    parser.add_argument('--place', choices=['entrance', 'stone', 'tree', 'courtyard'])
    parser.add_argument('--benchmark', action='store_true', help='Measure still and walking renders.')
    parser.add_argument('--quality', choices=['fine', 'auto', 'low'], default='fine',
                        help='Benchmark quality. fine keeps both render targets identical by default.')
    parser.add_argument('--measure-only', action='store_true', help='Skip PNG exposures and measure the route.')
    probes = parser.add_mutually_exclusive_group()
    probes.add_argument('--idle-only', dest='scenario', action='store_const', const='idle', help='Measure reduced-motion idle redraws and the first input response.')
    probes.add_argument('--restore-only', dest='scenario', action='store_const', const='restore', help='Compare full RGBA pixels at the same landmark before and after adapting to motion.')
    probes.add_argument('--natural-only', dest='scenario', action='store_const', const='natural', help='Drive the adaptive renderer with real rAF timestamps for at least 12 wall seconds.')
    parser.set_defaults(scenario='route')
    parser.add_argument('--compare', type=Path, help='Check all positions against a previous capture.json and compare equal buffers.')
    parser.add_argument('--width', type=int, default=WIDTH)
    parser.add_argument('--height', type=int, default=HEIGHT)
    parser.add_argument('--family-photo', type=Path, help='Include two fictional family members, using the built-in dog portrait and this local photo.')
    parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('google-chrome'))
    args = parser.parse_args()
    if args.width <= 0 or args.height <= 0:
        parser.error('Viewport dimensions must be positive.')
    if args.scenario != 'route':
        args.measure_only = True
        if args.compare:
            parser.error('--compare needs a route benchmark.')
        if args.scenario == 'restore' and args.quality != 'auto':
            parser.error('--restore-only needs --quality auto.')
    if args.compare:
        args.benchmark = True
    if args.measure_only:
        args.benchmark = True
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='qiguang-camera-') as temp:
        subprocess.run(
            ['node', '--input-type=module', '--eval', BUILD, str(SCRIPTS / 'scene-camera.mjs'), temp],
            cwd=args.site.resolve(), check=True,
        )
        Path(temp, 'index.html').write_text(HTML, encoding='utf8')
        if args.family_photo:
            prepare_family_fixture(Path(temp), args.family_photo)
        handler = partial(QuietHandler, directory=temp)
        with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                capture(args, 'http://127.0.0.1:' + str(server.server_port))
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    main()
