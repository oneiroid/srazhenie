#!/usr/bin/env python3
"""Generate rank portraits via local ComfyUI (SDXL). Writes art/raw/<key>_<seed>.png and art/raw/index.json."""
import json, sys, time, urllib.request, urllib.parse, random, os, argparse

COMFY = "http://127.0.0.1:8188"
OUT = os.path.join(os.path.dirname(__file__), "..", "art", "raw")
CKPT = "Juggernaut-X-RunDiffusion-NSFW.safetensors"

STYLE = ("vintage steel engraving illustration, napoleonic war 1812, monochrome ink line art, "
         "fine crosshatching, head and shoulders bust portrait, centered, facing viewer, "
         "plain white paper background, isolated, high contrast, book illustration")
NEG = ("color, photo, photorealistic, 3d render, blurry, text, letters, watermark, signature, frame, border, "
       "multiple people, cropped head, deformed, nsfw, nude")

SUBJECTS = {
    "marshal":    "old field marshal with grey sideburns, huge bicorne hat with tall white ostrich feather plume, heavy fringed epaulettes, high embroidered collar, many medals and stars, sash",
    "general":    "stern general, bicorne hat worn sideways, gold fringed epaulettes, embroidered high collar, order cross on neck",
    "colonel":    "cuirassier colonel wearing a classical crested metal helmet with long flowing horsehair mane, breastplate cuirass",
    "major":      "hussar major with big curled moustache, very tall shako hat with plume, braided hussar dolman jacket",
    "captain":    "infantry captain, shako hat with cockade and pompom, single epaulette, sword belt",
    "lieutenant": "young lieutenant, clean shaven, peaked officer cap with visor, high collar uniform with buttons",
    "sergeant":   "grizzled sergeant with moustache, soft forage cap, chevrons on sleeve, musket on shoulder",
    "sapper":     "bearded pioneer sapper wearing tall bearskin cap, holding a big axe over shoulder, leather apron",
    "soldier":    "young infantry private soldier, simple shako, musket with long bayonet held upright",
    "scout":      "scout in a hooded cloak looking through a long brass spyglass telescope",
    "mine":       "a single spherical black iron bomb ball lying on the ground, short rope fuse sticking out of the top with a small spark, classic round cartoon bomb silhouette, object only, no stand, no lamp, no people",
    "flag":       "regimental battle banner flag waving on a wooden pole with spear tip, fringe, object only, no people",
}

def wf(prompt, seed, size):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": size, "height": size, "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 22, "cfg": 6.0, "sampler_name": "dpmpp_2m",
              "scheduler": "karras", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "srazhenie", "images": ["8", 0]}},
    }

KLEIN_STYLE = ("Vintage 19th-century engraved book illustration, black ink on plain white paper, bold clean outlines "
               "with fine crosshatching, simple and highly legible, centered, isolated on a pure white background, "
               "no text, no frame, no border.")

def wf_klein(prompt, seed, size):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b-fp8.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["4", 0]}},
        "6": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": size, "height": size}},
        "10": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": size, "height": size, "batch_size": 1}},
        "11": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["6", 0], "guider": ["5", 0], "sampler": ["7", 0], "sigmas": ["8", 0], "latent_image": ["10", 0]}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "srazhenie", "images": ["12", 0]}},
    }

def post(path, data):
    req = urllib.request.Request(COMFY + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def get(path):
    return urllib.request.urlopen(COMFY + path).read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default=",".join(SUBJECTS))
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--model", default="klein")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, "index.json")
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    keys = a.keys.split(",")
    total, done = len(keys) * a.n, 0
    for key in keys:
        for _ in range(a.n):
            seed = random.randint(1, 2**31)
            t0 = time.time()
            graph = (wf_klein(f"{SUBJECTS[key]}. {KLEIN_STYLE}", seed, a.size) if a.model == "klein"
                     else wf(f"{SUBJECTS[key]}, {STYLE}", seed, a.size))
            pid = post("/prompt", {"prompt": graph})["prompt_id"]
            while True:
                h = json.loads(get(f"/history/{pid}"))
                if pid in h and h[pid].get("outputs"):
                    break
                if pid in h and h[pid].get("status", {}).get("status_str") == "error":
                    sys.exit(f"comfy error: {h[pid]['status']}")
                time.sleep(1)
            img = h[pid]["outputs"]["9"]["images"][0]
            data = get("/view?" + urllib.parse.urlencode(img))
            name = f"{key}_{seed}.png"
            open(os.path.join(OUT, name), "wb").write(data)
            index.append(name)
            json.dump(index, open(idx_path, "w"))
            done += 1
            print(f"[{done}/{total}] {name} {time.time()-t0:.1f}s", flush=True)

if __name__ == "__main__":
    main()
