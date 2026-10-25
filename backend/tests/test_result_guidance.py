"""Result-card copy: snapshot persistence, legacy defaults and API contracts."""
import json
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.core.database import Base
from app.core.config import settings
from app.models.entities import Diagnosis, Disease
from app.services import diagnosis_service as service
from app.services.seed import seed_database
from app.services.result_recovery import save_result

@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'guidance.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, 'upload_dir', tmp_path / 'uploads')
    monkeypatch.setattr(service, 'get_prediction_context', lambda: dict(prediction_mode='model', model_version='test', preprocessing_version='test', pair_model_version=None))
    monkeypatch.setattr(service, 'predict_pair', lambda _: None)
    with Session(engine) as session:
        seed_database(session)
        yield session
    engine.dispose()

def predict(monkeypatch, class_id):
    monkeypatch.setattr(service, 'predict_all', lambda _: [(class_id, .92)] + [(i,.01) for i in range(9) if i != class_id])

def assert_copy(result):
    assert result.summary_message and len(result.summary_message) <= 25
    assert [d.title for d in result.management_action_details] == result.management_actions
    assert all(d.description and len(d.description) <= 25 for d in result.management_action_details)

@pytest.mark.parametrize('class_id', range(9))
def test_all_classes_snapshot_and_refinement(db, sample_image, monkeypatch, class_id):
    predict(monkeypatch, class_id)
    created = service.diagnose_image(db, sample_image, 'leaf.jpg', None)
    assert_copy(created)
    seed_row = db.query(Disease).filter_by(model_class_id=class_id).one()
    seed_row.summary_message = 'changed current reference'
    seed_row.management_action_details = []
    db.commit()
    detail = service.get_diagnosis_detail(db, created.id)
    assert detail.summary_message == created.summary_message
    assert detail.management_action_details == created.management_action_details
    predict(monkeypatch, (class_id + 1) % 9)
    refined = service.refine_diagnosis(db, created.id, sample_image, 'second.jpg')
    assert refined.disease_name != created.disease_name
    assert_copy(refined)
    assert service.get_diagnosis_detail(db, created.id).management_action_details == refined.management_action_details

@pytest.mark.parametrize('has_snapshot', [False, True])
def test_old_records_do_not_receive_new_copy(db, sample_image, monkeypatch, has_snapshot):
    predict(monkeypatch, 0)
    result = service.diagnose_image(db, sample_image, 'leaf.jpg', None)
    record = db.get(Diagnosis, result.id)
    record.content_snapshot = {k:v for k,v in record.content_snapshot.items() if k not in ('summary_message','management_action_details')} if has_snapshot else None
    db.commit()
    old = service.get_diagnosis_detail(db, result.id)
    assert old.summary_message is None
    assert old.management_action_details == []
    assert old.management_actions

def test_save_failure_recovery_preserves_copy(db, sample_image, monkeypatch):
    predict(monkeypatch, 4)
    original_commit = db.commit
    def fail():
        raise SQLAlchemyError('simulated failure')
    monkeypatch.setattr(db, 'commit', fail)
    result = service.diagnose_image(db, sample_image, 'leaf.jpg', None, recover_save_failure=True)
    assert result.save_status == 'failed'
    assert_copy(result)
    monkeypatch.setattr(db, 'commit', original_commit)
    saved = save_result(db, result.recovery_token)
    assert saved.summary_message == result.summary_message
    assert saved.management_action_details == result.management_action_details
    assert service.get_diagnosis_detail(db, saved.id).summary_message == result.summary_message

@pytest.mark.parametrize('old_bundle', [False, True])
def test_offline_bundle_preserves_its_copy(client, sample_image, tmp_path, monkeypatch, old_bundle):
    rows = json.loads((Path(__file__).resolve().parents[1] / 'app/data/seed/diseases.json').read_text(encoding='utf-8'))
    if old_bundle:
        for row in rows:
            row.pop('summary_message'); row.pop('management_action_details')
    bundle = dict(version='a'*64, model_version='b'*64, preprocessing_version='test', diseases=rows)
    (tmp_path / ('manifest-'+'a'*16+'.json')).write_text(json.dumps(bundle), encoding='utf-8')
    monkeypatch.setattr(settings, 'offline_bundle_dir', tmp_path)
    meta = dict(client_record_id=str(uuid4()), model_version='b'*64, preprocessing_version='test', bundle_version='a'*64, created_at=datetime.now(timezone.utc).isoformat(), predictions=[dict(class_id=i,confidence=.92 if i==0 else .01) for i in range(9)])
    response=client.post('/api/v1/offline/records',data={'metadata':json.dumps(meta)},files={'file':('x.jpg',sample_image,'image/jpeg')})
    assert response.status_code==200,response.text
    result=response.json()
    assert result['summary_message']==(None if old_bundle else rows[0]['summary_message'])
    assert result['management_action_details']==([] if old_bundle else rows[0]['management_action_details'])

def test_response_contracts(client, sample_image, monkeypatch):
    predict(monkeypatch,0)
    created=client.post('/api/v1/diagnose',files={'file':('x.jpg',sample_image,'image/jpeg')})
    assert created.status_code==200,created.text
    identifier=created.json()['id']
    for response in [created,client.get('/api/v1/history/'+identifier),client.post('/api/v1/diagnose/'+identifier+'/refine',files={'file':('x.jpg',sample_image,'image/jpeg')})]:
        assert response.status_code==200,response.text
        assert response.json()['summary_message']
        assert [d['title'] for d in response.json()['management_action_details']]==response.json()['management_actions']
    doc=client.get('/openapi.json').json()
    for path,method in [('/api/v1/diagnose','post'),('/api/v1/diagnose/{diagnosis_id}/refine','post'),('/api/v1/history/{diagnosis_id}','get'),('/api/v1/results/{token}/save','post')]:
        schema=doc['paths'][path][method]['responses']['200']['content']['application/json']['schema']
        fields=doc['components']['schemas'][schema['$ref'].split('/')[-1]]['properties']
        assert {'summary_message','management_action_details'}<=fields.keys()

def test_recovery_endpoint_and_idempotency_preserve_copy(client, sample_image, monkeypatch):
    predict(monkeypatch,0)
    with monkeypatch.context() as patch:
        def fail(_):
            raise SQLAlchemyError('simulated failure')
        patch.setattr(Session,'commit',fail)
        response=client.post('/api/v1/diagnose',files={'file':('x.jpg',sample_image,'image/jpeg')})
    assert response.status_code==200,response.text
    failed=response.json()
    assert failed['save_status']=='failed'
    saved=client.post('/api/v1/results/'+failed['recovery_token']+'/save')
    repeated=client.post('/api/v1/results/'+failed['recovery_token']+'/save')
    assert saved.status_code==repeated.status_code==200
    for field in ('summary_message','management_action_details'):
        assert saved.json()[field]==repeated.json()[field]==failed[field]


def test_old_cached_response_defaults():
    from app.schemas.diagnosis import DiagnoseResponse, DIAGNOSIS_EXAMPLE
    original={k:v for k,v in DIAGNOSIS_EXAMPLE.items() if k not in ('summary_message','management_action_details')}
    result=DiagnoseResponse.model_validate(original)
    assert result.summary_message is None and result.management_action_details==[]
