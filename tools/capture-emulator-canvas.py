"""Capture only the owned Penpot canvas after its hosted image export failed.

The physical canvas was measured against a fresh desktop capture and the API
viewport. Refuse a changed window size; this is a session-specific review tool.
It does not click the canvas, alter shapes, or read connection credentials.
"""
import ctypes
from ctypes import wintypes
import json
import math
import pathlib
import subprocess
import sys
import time

import pyautogui
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / '.impeccable/review/emulator-native'
OWNED = 4130458
FILE = '24d9d841-759d-81bc-8008-b518bc70d8b3'
USER32 = ctypes.windll.user32


def call(code):
    completed = subprocess.run(
        ['node', 'tools/penpot-call.mjs', 'execute_code', '-'],
        input=code, text=True, capture_output=True, check=True,
        cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return json.loads(completed.stdout)['result']


def window():
    assert USER32.IsWindow(OWNED), 'Owned Canary window is gone'
    title = ctypes.create_unicode_buffer(256)
    USER32.GetWindowTextW(OWNED, title, 256)
    assert 'OpenSP - Penpot' in title.value, 'Owned title changed'
    pyautogui.press('alt')
    USER32.SetForegroundWindow(OWNED)
    time.sleep(.25)
    assert USER32.GetForegroundWindow() == OWNED, 'Owned focus not established'
    rect = wintypes.RECT()
    USER32.GetWindowRect(OWNED, ctypes.byref(rect))
    assert (rect.right-rect.left, rect.bottom-rect.top) == (1752, 1180), 'Recalibrate changed window geometry'
    pyautogui.moveTo(rect.left+350, rect.top+260)
    return rect


window()
state = call('return {file:penpot.currentFile.id,page:penpot.currentPage.name,zoom:penpot.viewport.zoom,center:penpot.viewport.center};')
assert state['file'] == FILE and state['page'] == 'Emulator'
boards = call('return penpot.root.children.filter(b=>b.type==="board"&&b.name.startsWith("Firmware emulator /")).map(b=>({id:b.id,name:b.name,x:b.x,y:b.y,width:b.width,height:b.height}));')
assert len(boards) == 4
if len(sys.argv)>1:
    selected=sys.argv[1]
    boards=[b for b in boards if '-'.join(b['name'].split(' / ')[1:]).lower()==selected]
    assert len(boards)==1, 'Unknown review board'
OUT.mkdir(parents=True, exist_ok=True)
records = []
for board in boards:
    zoom = 1 if board['width'] == 390 else .65
    width = round(board['width']*zoom)
    height = math.ceil(board['height']*zoom)
    assembled = Image.new('RGB', (width, height))
    strips = []
    for top in range(0, height, 800):
        rect = window()
        current = call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};')
        assert current['file'] == FILE and current['page'] == 'Emulator'
        center = {'x': board['x']+board['width']/2, 'y': board['y']+(top+404.5)/zoom}
        call('if(penpot.currentFile.id!=='+json.dumps(FILE)+'||penpot.currentPage.name!=="Emulator")throw Error("Unexpected canvas");penpot.viewport.zoom='+str(zoom)+';penpot.viewport.center='+json.dumps(center)+';return true;')
        time.sleep(.65)
        assert USER32.GetForegroundWindow() == OWNED, 'Focus changed before screenshot'
        pyautogui.moveTo(rect.left+350, rect.top+260)
        time.sleep(.2)
        take = min(800, height-top)
        # Fresh calibration: canvas center at (876,657.5). y253 avoids the MCP
        # toolbar. The requested native strip starts exactly at that y.
        pixels = pyautogui.screenshot(region=(rect.left+round(876-width/2), rect.top+253, width, take))
        assembled.paste(pixels, (0, top))
        strips.append({'pixelTop':top,'height':take,'viewportCenter':center})
    name = '-'.join(board['name'].split(' / ')[1:]).lower()+'.png'
    assembled.save(OUT/name)
    records.append({'file':name,'boardId':board['id'],'board':board['name'],'nativeWidth':board['width'],'nativeHeight':board['height'],'zoom':zoom,'width':width,'height':height,'method':'Unedited pixels from owned native canvas; adjacent vertical strips assembled','strips':strips})
    print('Captured '+name, flush=True)
current = call('return {file:penpot.currentFile.id,page:penpot.currentPage.name};')
assert current['file'] == FILE and current['page'] == 'Emulator'
call('if(penpot.currentFile.id!=='+json.dumps(FILE)+'||penpot.currentPage.name!=="Emulator")throw Error("Unexpected canvas");penpot.viewport.zoom='+str(state['zoom'])+';penpot.viewport.center='+json.dumps(state['center'])+';return true;')
manifest=OUT/'canvas-manifest.json'
if len(sys.argv)>1 and manifest.exists():
    old=json.loads(manifest.read_text(encoding='utf8'))['captures']
    replaced={r['boardId'] for r in records}
    records=[r for r in old if r['boardId'] not in replaced]+records
manifest.write_text(json.dumps({'fileId':FILE,'page':'Emulator','method':'Owned-window desktop fallback after hosted image-export timeouts','calibration':{'windowWidth':1752,'windowHeight':1180,'canvasCenterX':876,'canvasCenterY':657.5,'stripScreenTop':253},'captures':records},indent=2)+'\n',encoding='utf8')
