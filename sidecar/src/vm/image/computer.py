"""Only operates the guest's Xvfb display. Input arrives via stdin, never shell interpolation."""
import base64
import io
import json
import subprocess
import sys
from PIL import Image

request = json.loads(sys.stdin.readline())
name, args = request['name'], request['args']
def run(*argv):
    return subprocess.run(argv, check=True, stdout=subprocess.PIPE).stdout

if name == 'computer_screenshot':
    picture = Image.open(io.BytesIO(run('import', '-display', ':99', '-window', 'root', 'png:-')))
    region = args.get('region')
    if region:
        x, y = region['x'], region['y']
        picture = picture.crop((x, y, x + region['width'], y + region['height']))
    width = picture.width
    picture.thumbnail((min(args.get('maxWidth', 1440), 1440), 900))
    output = io.BytesIO()
    picture.save(output, format='PNG')
    print(json.dumps({'data': base64.b64encode(output.getvalue()).decode(), 'width': picture.width, 'height': picture.height, 'scale': picture.width / width, 'region': region}))
elif name == 'computer_click':
    run('xdotool', 'mousemove', str(round(args['x'])), str(round(args['y'])))
    mods = [{'cmd':'super', 'ctrl':'ctrl', 'alt':'alt', 'shift':'shift'}[m] for m in args.get('modifiers', [])]
    for mod in mods: run('xdotool', 'keydown', mod)
    try: run('xdotool', 'click', '--repeat', str(args.get('clickCount', 1)), {'left':'1','middle':'2','right':'3'}[args.get('button','left')])
    finally:
        for mod in mods: run('xdotool', 'keyup', mod)
    print('{}')
elif name == 'computer_type':
    run('xdotool', 'type', '--clearmodifiers', '--', args['text'])
    print('{}')
elif name == 'computer_key':
    combo = args['combo'].replace('cmd', 'super').replace('Enter','Return')
    run('xdotool', 'key', '--clearmodifiers', '--', combo)
    print('{}')
elif name == 'computer_scroll':
    run('xdotool', 'mousemove', str(round(args['x'])), str(round(args['y'])))
    for axis, positive, negative in [('dy','5','4'), ('dx','7','6')]:
        delta = args.get(axis, 0)
        if delta: run('xdotool','click','--repeat',str(min(50,max(1,round(abs(delta))))),positive if delta > 0 else negative)
    print('{}')
elif name == 'computer_frontmost':
    try: title = run('xdotool', 'getactivewindow', 'getwindowname').decode().strip()
    except subprocess.CalledProcessError: title = 'Xvfb'
    print(json.dumps({'name':title,'display':':99'}))
else:
    raise ValueError('Unsupported VM computer operation')
