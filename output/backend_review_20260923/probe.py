"""Isolated review probes. No network, production DB, or real model required."""
import asyncio
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
scratch = Path(tempfile.mkdtemp(prefix='cropy-backend-review-'))
os.environ['DATABASE_URL'] = f"sqlite:///{scratch / 'review.db'}"
os.environ['UPLOAD_DIR'] = str(scratch / 'uploads')
os.environ['ML_MODEL_PATH'] = str(scratch / 'absent.pth')

from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app.services import diagnosis_service as service
from app.core.database import SessionLocal
from app.models.entities import Diagnosis, DiseasePesticide
from sqlalchemy import text

buf = io.BytesIO()
Image.new('RGB', (64, 64), (40, 130, 20)).save(buf, 'JPEG')
jpeg = buf.getvalue()
observed = {}

with TestClient(app, raise_server_exceptions=False) as client:
    def diagnose(name='leaf.jpg', data=jpeg, crop=None):
        return client.post('/api/v1/diagnose', params={'crop_type': crop} if crop else {},
                           files={'file': (name, data, 'image/jpeg')})

    mock = diagnose().json()
    observed['mock'] = {'health': client.get('/api/v1/health').json(),
                        'diagnosis': {k: mock[k] for k in ['disease_name', 'confidence']},
                        'has_mode': any(k in mock for k in ['mode', 'is_mock', 'model_loaded'])}
    wrong = diagnose(crop='unsupported').json()
    selected = diagnose(crop='무').json()
    observed['crop'] = {'invalid_accepted': wrong['crop_type'],
                        'selected': selected['crop_type'], 'disease': selected['disease_name']}
    observed['timestamp'] = mock['created_at']

    with patch.object(service, 'predict', return_value=[(999, 0.99)]):
        res = diagnose()
        observed['unknown_class'] = {'status': res.status_code,
                                     'name': res.json()['disease_name'], 'score': res.json()['confidence']}

    # Benign HTML marker appended to valid JPEG; no script or external requests.
    html = diagnose('photo.html', jpeg + b'\n<html><body>REVIEW_MARKER</body></html>')
    served = client.get(html.json()['image_url'])
    observed['upload_html'] = {'post_status': html.status_code, 'get_status': served.status_code,
                               'content_type': served.headers.get('content-type'),
                               'retains_html': b'<html>' in served.content}

    before = set((scratch / 'uploads').iterdir())
    with patch.object(service, 'predict', side_effect=RuntimeError('simulated inference failure')):
        res = diagnose()
    observed['failed_upload'] = {'status': res.status_code,
                                 'orphan_files': len(set((scratch / 'uploads').iterdir()) - before)}

    # JPEG verify() checks headers but does not decode pixel data.
    truncated = jpeg[:-20]
    Image.open(io.BytesIO(truncated)).verify()
    def decode(path):
        Image.open(path).convert('RGB')
        return [(0, 0.9)]
    with patch.object(service, 'predict', side_effect=decode):
        res = diagnose(data=truncated)
    observed['truncated_jpeg'] = {'verify_passed': True, 'post_status': res.status_code}

    with patch.object(service, 'predict', return_value=[(2, .45), (3, .4), (0, .15)]):
        first = diagnose().json()
    detail = client.get('/api/v1/history/' + first['id']).json()
    observed['recapture_history'] = {'initial_has_guidance': first['recapture'] is not None,
                                    'history_has_guidance': detail['recapture'] is not None}
    with patch.object(service, 'predict_all', return_value=[(8, .9), (5, .1)]), \
         patch.object(service, 'predict_pair', return_value=None):
        refined = client.post('/api/v1/diagnose/' + first['id'] + '/refine',
                              files={'file': ('second.jpg', jpeg, 'image/jpeg')}).json()
        old_second = refined['refined_image_url']
        client.post('/api/v1/diagnose/' + first['id'] + '/refine',
                    files={'file': ('third.jpg', jpeg, 'image/jpeg')})
    observed['refine'] = {'crop': refined['crop_type'], 'disease': refined['disease_name'],
                          'replaced_image_still_served': client.get(old_second).status_code}

    with SessionLocal() as db:
        observed['sqlite_foreign_keys'] = db.execute(text('PRAGMA foreign_keys')).scalar()
        mappings = db.query(DiseasePesticide).order_by(DiseasePesticide.disease_id, DiseasePesticide.priority).all()
        target = mappings[0].disease_id
        rows = [x for x in mappings if x.disease_id == target]
        rows[0].priority, rows[-1].priority = 99, 0
        db.commit()
        desired_first = rows[-1].pesticide_id
    response = client.get(f'/api/v1/diseases/{target}').json()
    with SessionLocal() as db:
        from app.models.entities import Pesticide
        expected = db.get(Pesticide, desired_first).name
    observed['priority'] = {'expected_first': expected, 'actual_first': response['pesticides'][0]['name']}

    async def concurrency_probe():
        import httpx
        delays = []
        async def heartbeat():
            start = time.perf_counter()
            await asyncio.sleep(.02)
            delays.append(time.perf_counter() - start)
        def slow_predict(path):
            time.sleep(.3)
            return [(0, .9)]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as ac:
            timer = asyncio.create_task(heartbeat())
            await asyncio.sleep(0)
            with patch.object(service, 'predict', side_effect=slow_predict):
                await ac.post('/api/v1/diagnose', files={'file': ('x.jpg', jpeg, 'image/jpeg')})
            await timer
        return round(delays[0], 3)
    observed['event_loop'] = {'timer_expected_seconds': .02,
                              'timer_actual_seconds': asyncio.run(concurrency_probe()),
                              'injected_sync_inference_seconds': .3}

    async def body_limit_probe():
        from app.core.config import settings
        from app.api.routes import diagnosis as routes
        boundary = 'review-boundary'
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.jpg"\r\n'
                   'Content-Type: image/jpeg\r\n\r\n').encode() + b'x' * (2 * 1024 * 1024)
        payload += f'\r\n--{boundary}--\r\n'.encode()
        consumed = 0
        at_validation = []
        messages = []
        original = routes._read_image_upload
        async def tracked(file):
            at_validation.append(consumed)
            return await original(file)
        async def receive():
            nonlocal consumed
            block = payload[consumed:consumed + 65536]
            consumed += len(block)
            return {'type': 'http.request', 'body': block, 'more_body': consumed < len(payload)}
        async def send(message):
            messages.append(message)
        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                 'method': 'POST', 'scheme': 'http', 'path': '/api/v1/diagnose',
                 'raw_path': b'/api/v1/diagnose', 'query_string': b'', 'root_path': '',
                 'headers': [(b'content-type', f'multipart/form-data; boundary={boundary}'.encode())],
                 'server': ('test', 80), 'client': ('127.0.0.1', 1234)}
        with patch.object(settings, 'max_upload_mb', 1), patch.object(routes, '_read_image_upload', tracked):
            await app(scope, receive, send)
        return {'body_bytes': len(payload), 'bytes_received_before_limit_check': at_validation[0],
                'status': next(m['status'] for m in messages if m['type'] == 'http.response.start')}
    observed['multipart_limit'] = asyncio.run(body_limit_probe())

    with patch.object(Image, 'MAX_IMAGE_PIXELS', 1000):
        response = diagnose()
    observed['pixel_limit_error'] = {'status': response.status_code,
                                    'note': 'Small image with temporarily lowered Pillow pixel limit'}

# Exercise the real sync main with mocked PSIS transport and isolated output.
spec = importlib.util.spec_from_file_location('review_sync', ROOT / 'backend/scripts/sync_pesticides.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
sync_out = scratch / 'seed'
sync_out.mkdir()
def item(days):
    return dict(pestiCode='shared', pestiKorName='test ingredient', pestiBrandName='test brand',
                dilutUnit='1000배', useSuittime=f'수확{days}일전')
with patch.object(sync, 'SEED_DIR', sync_out), \
     patch.object(sync, 'DISEASE_QUERIES', {'a': ('crop-a', 'disease-a'), 'b': ('crop-b', 'disease-b')}), \
     patch.object(sync, 'fetch_items', side_effect=[[item(3)], [item(21)]]), \
     patch.object(sys, 'argv', ['sync', '--api-key', 'LOCAL_TEST_ONLY']):
    sync.main()
    observed['pesticide_context_loss'] = {'input_phi_days': [3, 21],
        'stored_phi_days': [p['phi_days'] for p in json.loads((sync_out / 'pesticides.json').read_text('utf-8'))],
        'mappings': json.loads((sync_out / 'disease_pesticides.json').read_text('utf-8'))}
with patch.object(sync, 'SEED_DIR', sync_out), \
     patch.object(sync, 'DISEASE_QUERIES', {'a': ('crop-a', 'disease-a'), 'b': ('crop-b', 'disease-b')}), \
     patch.object(sync, 'fetch_items', side_effect=[[item(3)], []]), \
     patch.object(sys, 'argv', ['sync', '--api-key', 'LOCAL_TEST_ONLY']):
    sync.main()
    observed['partial_sync'] = {'remaining_disease_keys': [m['disease_key'] for m in
        json.loads((sync_out / 'disease_pesticides.json').read_text('utf-8'))]}

class FakeResponse:
    text = '<response><resultCode>ERROR</resultCode><resultMsg>TEST</resultMsg></response>'
    def raise_for_status(self):
        pass
class FakeClient:
    def get(self, *args, **kwargs):
        return FakeResponse()
observed['business_error_xml'] = sync.fetch_items(FakeClient(), 'LOCAL_TEST_ONLY', 'a', 'b')

output = Path(__file__).with_name('evidence.json')
output.write_text(json.dumps(observed, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(observed, ensure_ascii=False, indent=2))
print('Isolated scratch:', scratch)
