import test from 'node:test';
import assert from 'node:assert/strict';
import { softmax, fuse, summarize } from '../public/offline/core.mjs';
const bundle = { model_version: 'm1', preprocessing_version: 'p1', version: 'v1',
  diseases: [{model_class_id: 2, name: '검은무늬병', crop_type: '무', category:'disease'},
             {model_class_id: 3, name:'노균병', crop_type:'무', category:'disease'}],
  policy: { version:'decision-v1', low_confidence_threshold:.5, confusion_margin:.2, second_photo_weight:.6,
    pairs:[{ids:[2,3],region:'잎 뒷면',instruction:'뒤집어 촬영',cues:{2:'동심원',3:'포자층'}}] } };
test('softmax remains finite with large logits', () => {
  const p = softmax([10000, 10001]); assert.ok(Math.abs(p[0]+p[1]-1)<1e-12); assert.ok(p[1]>p[0]);
});
test('refinement changes ranking using configured second-photo weight', () => {
  const p = fuse([{class_id:2,confidence:.51},{class_id:3,confidence:.49}], [{class_id:2,confidence:.1},{class_id:3,confidence:.9}], .6);
  assert.equal(p[0].class_id,3); assert.ok(Math.abs(p[0].confidence-.736)<1e-12);
});
test('crop mismatch and ambiguity retain separate reasons', () => {
  const result = summarize(bundle,[{class_id:2,confidence:.51},{class_id:3,confidence:.43}],'고추');
  assert.equal(result.decision_status,'crop_mismatch'); assert.deepEqual(result.decision_reasons,['crop_mismatch','confusion']);
  assert.equal(result.recapture.region,'잎 뒷면');
});
