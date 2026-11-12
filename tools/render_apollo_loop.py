# Renders frontend/public/landing/media/apollo-loop.{mp4,webm}: python tools/render_apollo_loop.py <dir with orig.jpg and alpha.png>, then ffmpeg (see the landing notes).
"""Apollo 14 background loop from NASA photo AS14-64-9089: the astronaut (hand-traced mask) sways and takes low-
gravity hops over a clean plate while the camera drifts; the right side fades to obsidian for the copy."""
import math, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
D = sys.argv[1]
W, H, FPS, SEC = 1600, 900, 30, 12
S = 1800
rgb = np.asarray(Image.open(f"{D}/orig.jpg").convert("RGB").resize((S, S), Image.LANCZOS)).astype(np.float32)
alpha = np.asarray(Image.open(f"{D}/alpha.png")).astype(np.float32) / 255
# Clean plate: fill a dilated astronaut hole from the nearest outside pixels, then soften it.
hole = ndi.binary_dilation(alpha > 0.02, iterations=28)
_, (iy, ix) = ndi.distance_transform_edt(hole, return_indices=True)
plate = rgb[iy, ix]
soft = np.stack([ndi.gaussian_filter(plate[..., c], 9) for c in range(3)], -1)
plate = np.where(hole[..., None], soft, rgb)
# Place the square photo on a wider canvas (photo side 1250 of a 1600x900 frame, plus a camera margin).
side, ox, oy, M = 1250, -60, -170, 80
CW, CH = W + 2 * M, H + 2 * M
def canvas(img_np):
    img = Image.fromarray(np.clip(img_np, 0, 255).astype(np.uint8)).resize((side, side), Image.LANCZOS)
    big = Image.new("RGB", (CW, CH), (0, 0, 0))
    # extend the ground to the right with a mirrored, blurred copy (it sits under the dark copy fade anyway)
    ext = img.transpose(Image.FLIP_LEFT_RIGHT).filter(ImageFilter.GaussianBlur(3))
    big.paste(ext, (ox + M + side, oy + M))
    big.paste(img.transpose(Image.FLIP_LEFT_RIGHT).filter(ImageFilter.GaussianBlur(3)), (ox + M - side, oy + M))
    big.paste(img, (ox + M, oy + M))
    return big
plate_c = canvas(plate)
astro = Image.fromarray(rgb.astype(np.uint8)).resize((side, side), Image.LANCZOS)
# The moving layer carries a feathered band of real ground around the suit, wider than the filled hole, so the
# blurred fill is never visible and the band melts into the untouched plate.
carrier = ndi.gaussian_filter(ndi.binary_dilation(alpha > 0.02, iterations=24).astype(np.float32), 6)
amask = Image.fromarray((np.clip(np.maximum(alpha, carrier), 0, 1) * 255).astype(np.uint8)).resize((side, side), Image.LANCZOS)
foot = (int(380 / 900 * side), int(748 / 900 * side))  # pivot at the boots
# Obsidian fade on the right and a soft vignette, in frame coordinates.
xs = np.linspace(0, 1, W)[None, :, None]; ys = np.linspace(0, 1, H)[:, None, None]
fade = np.clip((xs - 0.5) / 0.32, 0, 1) ** 1.4 * 0.9
vig = 1 - 0.35 * ((xs - 0.35) ** 2 * 1.4 + (ys - 0.5) ** 2 * 2.2)
obs = np.array([11, 17, 20], np.float32)
tint = np.array([0.97, 1.0, 1.03], np.float32)  # faint cool cast, near monochrome
for f in range(FPS * SEC):
    t = f / (FPS * SEC); a = 2 * math.pi * t
    frame = plate_c.copy()
    dx = 8 * math.sin(a); hop = 4 * abs(math.sin(2 * a)); rot = 0.7 * math.sin(a)
    layer = astro.rotate(rot, center=foot, resample=Image.BICUBIC)
    mk = amask.rotate(rot, center=foot, resample=Image.BICUBIC)
    frame.paste(layer, (int(ox + M + dx), int(oy + M - hop)), mk)
    zoom = 1.0 + 0.035 * (1 - math.cos(a)) / 2
    cx, cy = CW / 2 + 22 * math.sin(a + 0.6), CH / 2 + 8 * math.sin(a)
    w2, h2 = W / zoom / 2, H / zoom / 2
    view = frame.crop((int(cx - w2), int(cy - h2), int(cx + w2), int(cy + h2))).resize((W, H), Image.BICUBIC)
    v = np.asarray(view).astype(np.float32) * tint * vig
    v = v * (1 - fade) + obs * fade
    Image.fromarray(np.clip(v, 0, 255).astype(np.uint8)).save(f"{D}/frames/f{f:04d}.jpg", quality=92)
print("frames", FPS * SEC)
