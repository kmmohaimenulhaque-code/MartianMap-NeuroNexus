# NeuroNexus — Martian Map
## Scientific & GPU Validation Results

Date: 2026-09-19

This document records verified experimental results from the NeuroNexus
Martian Map terrain-processing pipeline.

---

# 1. COMPUTE ENVIRONMENT

GPU:
AMD Instinct MI300X VF

PyTorch:
2.11.0+rocm7.13.0

ROCm/HIP:
7.13.99004

GPU availability:
True

Operating system:
Ubuntu 24.04.4 LTS

---

# 2. SCIENTIFIC / DATA STACK

NumPy     : 2.4.6
SciPy     : 1.18.1
Pandas    : 3.0.6
Polars    : 1.44.2
PyArrow   : 25.0.1
xarray    : 2026.7.0
h5py      : 3.16.0
Numba     : 0.67.0

VTK       : 9.7.0
PyVista   : 0.49.0
Trimesh   : 5.1.0

PDS4 Tools : READY
Rasterio   : 1.5.1
GeoPandas  : 1.1.4

---

# 3. NASA MOLA DATA INGESTION

Source:
NASA / Mars Global Surveyor / Mars Orbiter Laser Altimeter (MOLA)

PDS4 archive:
https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/

Product:
megt90n000eb.img

PDS4 label:
megt90n000eb.xml

Grid:
2880 × 5760

Total samples:
16,588,800

Raw dtype:
>i2 (SignedMSB2)

Raw minimum:
-8177

Raw maximum:
21171

Raw mean:
-721.11

Units:
meter

Sampling resolution:
0.0625° × 0.0625°

Reference system:
IAU2000

Axis order:
Last Index Fastest

Status:
REAL NASA MOLA DATA SUCCESSFULLY LOADED

---

# 4. COORDINATE-AWARE XARRAY DATASET

Dataset dimensions:

latitude:
2880

longitude:
5760

Elevation dtype:
float32

Elevation range:
-8177.00 m → 21171.00 m

Latitude range:
-89.9688° → 89.9688°

Longitude range:
0.0312° → 359.9688°

Dataset size:
approximately 66 MB

Dataset attributes:

mission:
Mars Global Surveyor

instrument:
Mars Orbiter Laser Altimeter

product:
MEG016

reference_system:
IAU2000

Status:
MOLA XARRAY DATASET READY

NOTE:
The current coordinate construction is a working coordinate model based
on the documented 0.0625° sampling. Exact pixel-center/seam conventions
should be validated against the full PDS4 metadata before production use.

---

# 5. CPU TERRAIN DERIVATIVES

The CPU implementation provides a reference implementation for:

- slope
- aspect
- local elevation-range roughness

Input:
2880 × 5760 MOLA elevation grid

Results:

slope_deg
shape    : (2880, 5760)
dtype    : float32
minimum  : 0.0000
maximum  : 85.7286
mean     : 1.2503
finite   : 1.0000

aspect_deg
shape    : (2880, 5760)
dtype    : float32
minimum  : 0.0000
maximum  : 359.9828
mean     : 179.1126
finite   : 1.0000

roughness_m
shape    : (2880, 5760)
dtype    : float32
minimum  : 0.0000
maximum  : 6017.0000
mean     : 167.0559
finite   : 1.0000

Status:
CPU TERRAIN DERIVATIVE REFERENCE PIPELINE READY

NOTE:
roughness_m currently represents a simple 3×3 local elevation range.
It is not being presented as a standard Terrain Ruggedness Index (TRI).

The unusually high roughness maximum should be investigated before
using roughness as a production scientific/hazard metric.

---

# 6. MI300X GPU TERRAIN ENGINE

GPU implementation:
science/gpu/terrain_gpu.py

The MI300X implementation computes:

- slope
- aspect

using PyTorch on the AMD Instinct MI300X.

Input:
2880 × 5760 MOLA terrain

Results:

slope_deg
shape  : (2880, 5760)
dtype  : float32
minimum: 0.0000
maximum: 85.7282
mean   : 1.2503
finite : 1.0000

aspect_deg
shape  : (2880, 5760)
dtype  : float32
minimum: 0.0000
maximum: 359.9828
mean   : 179.1126
finite : 1.0000

Status:
MI300X TERRAIN ENGINE READY

---

# 7. CPU ↔ MI300X NUMERICAL VALIDATION

Real NASA MOLA terrain was processed independently by:

1. CPU reference implementation
2. MI300X GPU implementation

Input:
16,588,800 elevation samples

## Aspect

Maximum absolute error:
0.00027466°

Mean absolute error:
0.00000743°

CPU finite fraction:
1.0000

GPU finite fraction:
1.0000

## Slope

Maximum absolute error:
0.00224304°

Mean absolute error:
0.00000145°

CPU finite fraction:
1.0000

GPU finite fraction:
1.0000

Conclusion:

The MI300X implementation agrees very closely with the CPU reference
implementation within the measured numerical differences.

---

# 8. PERFORMANCE BENCHMARK

Benchmark:
Real NASA MOLA terrain
2880 × 5760
16,588,800 samples

CPU reference:

1.0039 seconds

MI300X GPU:

0.0365 seconds

Measured speedup:

27.52×


CPU time : 1.0039 s
GPU time : 0.0365 s
Speedup  : 27.52×

Status:
CPU ↔ MI300X BENCHMARK COMPLETE

---

# 9. CURRENT PIPELINE

NASA MOLA
    ↓
PDS4 ingestion
    ↓
validation
    ↓
coordinate-aware xarray dataset
    ↓
terrain derivatives
    ↓
MI300X acceleration
    ↓
mesh generation
    ↓
GLB / GLTF
    ↓
Three.js / WebGL
    ↓
Interactive Martian Map

---

# 10. CURRENT GPU STATUS

Implemented:

[READY] MOLA terrain loading
[READY] GPU elevation transfer
[READY] GPU slope
[READY] GPU aspect
[READY] CPU reference validation
[READY] CPU ↔ GPU numerical comparison
[READY] MI300X performance benchmark

Not yet implemented:

[PENDING] GPU roughness
[PENDING] GPU mesh generation
[PENDING] adaptive terrain LOD
[PENDING] GLB/GLTF terrain export
[PENDING] browser terrain streaming
[PENDING] interactive Martian map
[PENDING] terrain intelligence / hazard layers

---

# 11. SCIENTIFIC CAVEATS

1. The MOLA data is real NASA data and was successfully decoded from
   the PDS4 product.

2. The current xarray coordinate construction is provisional and should
   be cross-checked against the complete PDS4 coordinate metadata.

3. No undocumented scaling factor has been invented for the raw
   SignedMSB2 MOLA values.

4. Fill/no-data metadata requires deeper PDS4 label inspection before
   production-grade masking is finalized.

5. The current roughness calculation is a simple 3×3 elevation-range
   metric and should not be confused with standard TRI or other
   established terrain ruggedness metrics.

6. The benchmark demonstrates acceleration for the implemented slope
   and aspect calculations. It does not claim that every part of the
   NeuroNexus pipeline runs on the MI300X.

---

# 12. VERIFIED MILESTONE

NeuroNexus has successfully demonstrated:

REAL NASA MOLA DATA
        +
SCIENTIFIC TERRAIN PROCESSING
        +
AMD MI300X GPU ACCELERATION
        +
NUMERICAL VALIDATION
        +
27.52× MEASURED SPEEDUP

This establishes the computational foundation for the next stage:

MOLA → GPU terrain intelligence → GPU mesh generation → GLB/GLTF → WebGL Mars.

