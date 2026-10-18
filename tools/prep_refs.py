#!/usr/bin/env python3
"""Reference photos art/ref/<set>/<key>.jpg -> square head-and-shoulders crops on white, art/ref/<set>/prep/<key>.png.
The person is cut out with u2net_human_seg (OpenCV DNN); the crops feed img2img in gen_art.py --ref."""
import os, sys, glob
import cv2, numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..")
MODEL = "/media/oneiroid/sub/workspace/lib_oneiro/ComfyUI/models/rembg/u2net_human_seg.onnx"
SIZE = 768

def matte(net, img):
    x = cv2.resize(img, (320, 320), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255
    x = (x - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)
    net.setInput(x.transpose(2, 0, 1)[None].astype(np.float32))
    m = net.forward()[0, 0]
    m = (m - m.min()) / (m.max() - m.min() + 1e-6)
    return cv2.resize(m, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)

def main(set_name):
    net = cv2.dnn.readNetFromONNX(MODEL)
    src = os.path.join(ROOT, "art", "ref", set_name)
    out = os.path.join(src, "prep")
    os.makedirs(out, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(src, "*.jpg"))):
        key = os.path.splitext(os.path.basename(path))[0]
        img = cv2.imread(path)
        m = matte(net, img)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        comp = gray * m + 255 * (1 - m)
        ys, xs = np.where(m > 0.5)
        top, l, r = ys.min(), xs.min(), xs.max()
        side = min(r - l, img.shape[0] - top, img.shape[1])
        cx = (l + r) // 2
        x0 = int(np.clip(cx - side // 2, 0, img.shape[1] - side))
        y0 = max(0, int(top - side * 0.06))
        pad = np.full((img.shape[0] + side, img.shape[1]), 255, np.float32)
        pad[:img.shape[0]] = comp
        sq = pad[y0:y0 + side, x0:x0 + side]
        cv2.imwrite(os.path.join(out, f"{key}.png"), cv2.resize(sq, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.uint8))
        print(key, img.shape[1], "x", img.shape[0], "->", side)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "nomenklatura")
