import json
import os

import cv2
import numpy as np

_DIR = os.path.dirname(__file__)
_ONNX = os.path.join(_DIR, "wrinkle_seg.onnx")
_META = os.path.join(_DIR, "wrinkle_seg_meta.json")
_THRESH = os.path.join(_DIR, "wrinkle_seg_thresholds.json")

_session = None
_meta = None
_thresholds = {}


def _load():
    """Ленивая загрузка ONNX-сессии и меты (один раз)."""
    global _session, _meta, _thresholds
    if _session is not None:
        return True
    if not (os.path.exists(_ONNX) and os.path.exists(_META)):
        print(f"[seg] модель не найдена: {_ONNX}")
        return False
    import onnxruntime as ort

    _meta = json.load(open(_META, encoding="utf-8"))
    if os.path.exists(_THRESH):
        _thresholds = json.load(open(_THRESH, encoding="utf-8"))
    so = ort.SessionOptions()
    so.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
    _session = ort.InferenceSession(_ONNX, sess_options=so, providers=["CPUExecutionProvider"])
    print(f"[seg] загружена модель ({len(_meta['classes'])} классов, res={_meta['res']})")
    return True


def _preprocess(img_rgb, res, mean, std):
    x = cv2.resize(img_rgb, (res, res), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - np.array(mean, np.float32)) / np.array(std, np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1))[None].astype(np.float32)


def _mask_to_polygons(mask, res, min_area, eps_frac=0.002):
    """Контуры бинарной маски -> нормированные полигоны (с упрощением)."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for c in cnts:
        if cv2.contourArea(c) < min_area:
            continue
        approx = cv2.approxPolyDP(c, eps_frac * cv2.arcLength(c, True), True)
        if len(approx) < 3:
            continue
        polys.append([{"x": float(p[0][0]) / res, "y": float(p[0][1]) / res} for p in approx])
    return polys


def predict_segmentation(image_path: str, tta: bool = True):
    """Возвращает {label: [polygons]} нормированных полигонов. {} если лицо/файл не читается."""
    if not _load():
        return {}
    try:
        bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if bgr is None:
            return {}
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        res = _meta["res"]
        x = _preprocess(rgb, res, _meta["mean"], _meta["std"])

        prob = _session.run(None, {"input": x})[0][0]  # (C, res, res)
        if tta:
            xf = np.ascontiguousarray(x[:, :, :, ::-1])
            prob_f = _session.run(None, {"input": xf})[0][0][:, :, ::-1]
            prob = (prob + prob_f) / 2.0

        min_area = max(8, round(res * res * 1e-4))
        out = {}
        for ci, label in enumerate(_meta["classes"]):
            thr = _thresholds.get(label, 0.5)
            mask = (prob[ci] > thr).astype(np.uint8)
            polys = _mask_to_polygons(mask, res, min_area)
            if polys:
                out[label] = polys
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] predict_segmentation: {e}")
        return {}


if __name__ == "__main__":
    import sys

    res = predict_segmentation(sys.argv[1])
    print({k: len(v) for k, v in res.items()})
