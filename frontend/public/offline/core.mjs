export function softmax(logits) {
  const max = Math.max(...logits);
  const values = Array.from(logits, x => Math.exp(x - max));
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map(x => x / sum);
}
export function distribution(scores, ids) {
  return scores.map((confidence, i) => ({ class_id: ids[i], confidence })).sort((a, b) => b.confidence - a.confidence);
}
export function fuse(first, second, weight) {
  const map = new Map(second.map(p => [p.class_id, p.confidence]));
  return first.map(p => ({ class_id: p.class_id, confidence: (1 - weight) * p.confidence + weight * map.get(p.class_id) }))
    .sort((a, b) => b.confidence - a.confidence);
}
export function summarize(bundle, predictions, crop) {
  const disease = bundle.diseases.find(d => d.model_class_id === predictions[0].class_id);
  const other = disease.category === 'other';
  const [first, second] = predictions;
  const pair = !other && second && bundle.policy.pairs.find(p => p.ids.includes(first.class_id) && p.ids.includes(second.class_id));
  const margin = second ? first.confidence - second.confidence : 1;
  const recapture = pair && margin < bundle.policy.confusion_margin ? {
    region: pair.region, instruction: pair.instruction, margin,
    candidates: pair.ids.map(id => ({ name: bundle.diseases.find(d => d.model_class_id === id).name, cue: pair.cues[id] })),
  } : null;
  // 판별 불가: no crop leaf was recognized, so mismatch/confusion/score do not apply.
  const reasons = other ? ['not_crop'] : [];
  if (!other && crop && crop !== disease.crop_type) reasons.push('crop_mismatch');
  if (recapture) reasons.push('confusion');
  if (!other && first.confidence < bundle.policy.low_confidence_threshold) reasons.push('low_confidence');
  return {
    disease_name: disease.name, predicted_crop: disease.crop_type, selected_crop: crop || null,
    crop_type: crop || (other ? null : disease.crop_type), crop_mismatch: reasons.includes('crop_mismatch'),
    prediction_mode: 'browser', model_version: bundle.model_version, preprocessing_version: bundle.preprocessing_version,
    category: disease.category, severity: disease.severity, confidence: first.confidence,
    top_predictions: predictions.slice(0, 3).map(p => ({ name: bundle.diseases.find(d => d.model_class_id === p.class_id).name, confidence: p.confidence })),
    description: disease.description, causes: disease.causes, prevention: disease.prevention,
    management_actions: disease.management_actions || [],
    summary_message: disease.summary_message ?? null,
    management_action_details: (disease.management_action_details ?? []).map(
      detail => ({ title: detail.title, description: detail.description }),
    ),
    pesticides: disease.pesticides || [],
    recapture, decision_status: reasons[0] || (disease.category === 'normal' ? 'normal' : 'disease'), decision_reasons: reasons,
    policy_version: `${bundle.policy.version}:low=${bundle.policy.low_confidence_threshold}`, content_status: 'snapshot', content_version: bundle.version,
  };
}
