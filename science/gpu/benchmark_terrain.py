"""
NeuroNexus CPU vs MI300X terrain benchmark.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import torch

from science.ingestion.mola_dataset import load_mola
from science.terrain.derivatives import compute_terrain_derivatives
from science.gpu.terrain_gpu import terrain_derivatives_gpu


MOLA_PATH = Path("data/raw/mola/meg016/megt90n000eb.img")


def benchmark_cpu(elevation: np.ndarray):
    start = time.perf_counter()

    result = compute_terrain_derivatives(elevation)

    elapsed = time.perf_counter() - start

    return result, elapsed


def benchmark_gpu(elevation: np.ndarray):
    if torch.cuda.is_available():
        torch.cuda.synchronize()

    start = time.perf_counter()

    result = terrain_derivatives_gpu(elevation)

    if torch.cuda.is_available():
        torch.cuda.synchronize()

    elapsed = time.perf_counter() - start

    return result, elapsed


def compare(
    cpu_result: dict[str, np.ndarray],
    gpu_result: dict[str, np.ndarray],
) -> None:

    print()
    print("NUMERICAL VALIDATION")
    print("-" * 60)

    common_keys = sorted(
        set(cpu_result) & set(gpu_result)
    )

    for name in common_keys:

        cpu = cpu_result[name]
        gpu = gpu_result[name]

        absolute_error = np.abs(cpu - gpu)

        print()
        print(name)

        print(
            f"  max absolute error  : "
            f"{float(absolute_error.max()):.8f}"
        )

        print(
            f"  mean absolute error : "
            f"{float(absolute_error.mean()):.8f}"
        )

        print(
            f"  CPU finite          : "
            f"{float(np.isfinite(cpu).mean()):.4f}"
        )

        print(
            f"  GPU finite          : "
            f"{float(np.isfinite(gpu).mean()):.4f}"
        )

    cpu_only = sorted(
        set(cpu_result) - set(gpu_result)
    )

    gpu_only = sorted(
        set(gpu_result) - set(cpu_result)
    )

    if cpu_only:
        print()
        print(
            "CPU-only derivatives : "
            + ", ".join(cpu_only)
        )

    if gpu_only:
        print(
            "GPU-only derivatives : "
            + ", ".join(gpu_only)
        )


def main() -> None:

    print("=" * 60)
    print("       NEURONEXUS CPU vs MI300X BENCHMARK")
    print("=" * 60)

    if not torch.cuda.is_available():
        raise RuntimeError(
            "MI300X / ROCm GPU is not available."
        )

    print(
        f"GPU     : "
        f"{torch.cuda.get_device_name(0)}"
    )

    print(
        f"PyTorch : "
        f"{torch.__version__}"
    )

    print(
        f"ROCm/HIP: "
        f"{torch.version.hip}"
    )

    print()
    print("Loading real NASA MOLA terrain...")

    ds = load_mola(MOLA_PATH)

    elevation = ds["elevation"].values

    print(f"Terrain : {elevation.shape}")
    print(f"Samples : {elevation.size:,}")

    print()
    print("Running CPU reference...")

    cpu_result, cpu_time = benchmark_cpu(
        elevation
    )

    print(
        f"CPU time : "
        f"{cpu_time:.4f} seconds"
    )

    print()
    print("Running MI300X GPU...")

    # Warm-up run.
    benchmark_gpu(elevation)

    # Timed run.
    gpu_result, gpu_time = benchmark_gpu(
        elevation
    )

    print(
        f"GPU time : "
        f"{gpu_time:.4f} seconds"
    )

    speedup = cpu_time / gpu_time

    compare(
        cpu_result,
        gpu_result,
    )

    print()
    print("=" * 60)
    print("PERFORMANCE")
    print("-" * 60)

    print(
        f"CPU time : "
        f"{cpu_time:.4f} s"
    )

    print(
        f"GPU time : "
        f"{gpu_time:.4f} s"
    )

    print(
        f"Speedup  : "
        f"{speedup:.2f}x"
    )

    print("=" * 60)
    print(
        "🟢 CPU ↔ MI300X "
        "BENCHMARK COMPLETE"
    )
    print("=" * 60)


if __name__ == "__main__":
    main()
