# python qwen.py out.png seed "prompt"  — Qwen-Image-Fast (HF Space) через Gradio queue API, 9:16
import json, os, sys, urllib.request, uuid
out, seed, prompt = sys.argv[1], int(sys.argv[2]), sys.argv[3]
BASE = 'https://mcp-tools-qwen-image-fast.hf.space'
tok = open(os.path.expanduser('~/.cache/huggingface/token')).read().strip()
H = {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}
sh = uuid.uuid4().hex[:10]
body = {'data': [prompt, seed, False, '9:16', 1.0, 8], 'fn_index': None, 'api_name': '/generate_image', 'session_hash': sh, 'event_data': None, 'trigger_id': None}
# fn_index нужен очереди: возьмём из config
cfg = json.load(urllib.request.urlopen(urllib.request.Request(BASE + '/config', headers=H), timeout=60))
for i, d in enumerate(cfg['dependencies']):
    if d.get('api_name') == 'generate_image':
        body['fn_index'] = d.get('id', i)
urllib.request.urlopen(urllib.request.Request(BASE + '/gradio_api/queue/join', data=json.dumps(body).encode(), headers=H), timeout=60).read()
resp = urllib.request.urlopen(urllib.request.Request(BASE + '/gradio_api/queue/data?session_hash=' + sh, headers=H), timeout=300)
for raw in resp:
    line = raw.decode().strip()
    if not line.startswith('data:'):
        continue
    msg = json.loads(line[5:])
    if msg.get('msg') == 'process_completed':
        if not msg.get('success'):
            print('FAIL', json.dumps(msg.get('output'))[:400]); sys.exit(1)
        img = msg['output']['data'][0]
        url = img['url'] if isinstance(img, dict) else img
        if not url.startswith('http'):
            url = BASE + '/gradio_api/file=' + url
        data = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=120).read()
        open(out, 'wb').write(data)
        print('OK', out, len(data), 'seed', msg['output']['data'][1] if len(msg['output']['data']) > 1 else '')
        break
    elif msg.get('msg') in ('estimation', 'process_starts'):
        pass
