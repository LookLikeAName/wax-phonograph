#!/usr/bin/env python3
"""產生 smoke_test 用的測試音檔：8 秒、緩慢顫音的正弦波（單聲道 44.1 kHz WAV）。
用法：python3 tests/make_test_audio.py [輸出路徑，預設 ~/phono-test/tone.wav]"""
import math, pathlib, struct, sys, wave
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '~/phono-test/tone.wav').expanduser()
out.parent.mkdir(parents=True, exist_ok=True)
sr = 44100
with wave.open(str(out), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * (330 + 110 * math.sin(i / sr)) * i / sr))) for i in range(sr * 8)))
print(out)
