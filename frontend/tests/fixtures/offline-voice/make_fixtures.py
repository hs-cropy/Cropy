"""오프라인 음성 테스트의 기준 데이터를 만든다 (Python 서버 쪽 계산이 기준).
실행: python frontend/tests/fixtures/offline-voice/make_fixtures.py <wav 하나> [<STT 받아 적기 결과 txt>]
필요: numpy, kaldi-native-fbank, onnxruntime (모델 메타데이터), 저장소의 stt/lexicon.py·stt/terms.txt
- fbank.json: wav 앞 0.6초(16kHz int16, base64)와 kaldi-native-fbank(sherpa SenseVoice 설정) 80차 특징
- lexicon.json: 문장 → stt/lexicon.py 보정 결과
"""
import base64, json, sys, wave
from pathlib import Path
import numpy as np, kaldi_native_fbank as knf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "stt"))
from lexicon import Lexicon, load_terms  # noqa: E402

w = wave.open(sys.argv[1]); assert w.getframerate() == 16000 and w.getnchannels() == 1
pcm = np.frombuffer(w.readframes(w.getnframes()), np.int16)[:9600]
x = pcm.astype(np.float32) / 32768
o = knf.FbankOptions(); o.frame_opts.dither = 0; o.frame_opts.window_type = "hamming"; o.frame_opts.snip_edges = True
o.mel_opts.num_bins = 80; o.mel_opts.high_freq = 0; o.mel_opts.low_freq = 20
f = knf.OnlineFbank(o); f.accept_waveform(16000, (x * 32768).tolist()); f.input_finished()
feats = [list(map(float, f.get_frame(i))) for i in range(f.num_frames_ready)]
(HERE / "fbank.json").write_text(json.dumps({"pcm16_base64": base64.b64encode(pcm.tobytes()).decode(), "fbank": [[round(v, 5) for v in r] for r in feats]}), encoding="utf-8")

lex = Lexicon(load_terms(ROOT / "stt" / "terms.txt"))
sentences = Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if len(sys.argv) > 2 else []
sentences += ["이곳 탄접병 맞 아요", "배추 무음병 에 쓸 약 알려 줘", "농약휘석 배 수가 얼마 예요", "검은무늬가 생겼어요", "다시 촬영 해 줘",
              "고충탄접병 약 뭐야", "탄젖 병 맞아", "무 검은 무늬병 다음으로 높은 거", "배수 얼마야", "살펴 봐 줘", "5추 탄저병", "검은썩금병 이야"]
sentences = list(dict.fromkeys(s.strip() for s in sentences if s.strip()))
(HERE / "lexicon.json").write_text(json.dumps([{"in": s, "out": lex.correct(s)[0]} for s in sentences], ensure_ascii=False, indent=0), encoding="utf-8")
print(len(feats), "frames,", len(sentences), "sentences")
