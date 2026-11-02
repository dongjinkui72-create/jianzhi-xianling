# -*- coding: utf-8 -*-
"""用本机 ComfyUI 生成「剪纸仙灵」App 图标封面"""
import json, time, urllib.request, os, sys

COMFY = "http://127.0.0.1:8188"
OUT = r"E:\ComfyUI\ComfyUI-aki-v3.2\ComfyUI\output"
DEST = r"D:\董金奎\Documents\ai\jianzhi-xianling\assets"

POSITIVE = (
    "premium mobile app icon, single centered emblem, 3D render, "
    "a delicate Chinese paper-cut style fairy spirit silhouette made of translucent frosted crystal glass, "
    "ice white and pale sky blue glassmorphism, glossy translucent edges with soft inner glow, "
    "elegant flowing ribbon-like papercut curves, tiny floating crystal shards around it, "
    "clean minimal composition, plain very light icy white background with subtle soft blue gradient, "
    "soft studio lighting, gentle rim light, delicate caustics, shallow depth of field, "
    "high end product render, octane render, ultra detailed, 8k, symmetrical, no text"
)
NEGATIVE = (
    "text, letters, words, numbers, watermark, signature, logo text, blurry, lowres, "
    "dark background, black background, cluttered, busy, multiple icons, cropped, cut off, "
    "ugly, deformed, extra limbs, noise, jpeg artifacts, border, frame, rounded rectangle outline, "
    "photograph of a person, face, human, cartoon, flat vector, oversaturated"
)

def build(seed):
    return {
        "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "RealVisXL_V5.0_fp16.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": POSITIVE, "clip": ["3", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["3", 1]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": 34, "cfg": 6.0, "sampler_name": "dpmpp_2m",
            "scheduler": "karras", "denoise": 1.0,
            "model": ["3", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["6", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "jianzhi_icon", "images": ["8", 0]}},
    }

def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def get(url):
    return json.loads(urllib.request.urlopen(url, timeout=60).read())

seeds = [20261102, 778899]
ids = []
for s in seeds:
    r = post(COMFY + "/prompt", {"prompt": build(s)})
    ids.append((s, r["prompt_id"]))
    print("submitted seed", s, "->", r["prompt_id"])

files = []
deadline = time.time() + 420
while len(files) < len(ids) and time.time() < deadline:
    time.sleep(4)
    for s, pid in ids:
        try:
            h = get(COMFY + "/history/" + pid)
        except Exception:
            continue
        if pid in h:
            outs = h[pid].get("outputs", {})
            for node in outs.values():
                for img in node.get("images", []):
                    p = os.path.join(OUT, img.get("subfolder", ""), img["filename"])
                    if os.path.exists(p) and p not in files:
                        files.append(p)
                        print("done:", p)

if not files:
    print("!! 没有产出图片"); sys.exit(1)

# ---- 后处理成 Expo 需要的各种尺寸 ----
from PIL import Image, ImageFilter

os.makedirs(DEST, exist_ok=True)

def save(img, name, size):
    img = img.convert("RGB").resize((size, size), Image.LANCZOS)
    path = os.path.join(DEST, name)
    img.save(path, "PNG", optimize=True)
    print("wrote", path, size)

for i, f in enumerate(files):
    src = Image.open(f).convert("RGB")
    tag = "" if i == 0 else f".cand{i}"
    # 主图标：整幅
    save(src, f"icon{tag}.png", 1024)
    # 自适应图标：主体缩到中心 62% 安全区，四周补水晶白底
    canvas = Image.new("RGB", (1024, 1024), (247, 250, 255))
    inner = src.resize((640, 640), Image.LANCZOS)
    canvas.paste(inner, ((1024 - 640) // 2, (1024 - 640) // 2))
    save(canvas, f"adaptive-icon{tag}.png", 1024)
    # 启动图图标
    save(src, f"splash-icon{tag}.png", 512)
    # favicon
    save(src, f"favicon{tag}.png", 64)

print("SOURCE_FILES=" + "|".join(files))