from science.spatial.mola_core import MolaSpatialCore


core = MolaSpatialCore()

tests = [
    # Latitude boundaries
    (-87.999999, 0.0),
    (-44.000001, 0.0),
    (-43.999999, 0.0),
    (-0.000001, 0.0),
    (0.000001, 0.0),
    (43.999999, 0.0),
    (44.000001, 0.0),
    (87.999999, 0.0),

    # Longitude seams
    (10.0, 0.000001),
    (10.0, 89.999999),
    (10.0, 90.000001),
    (10.0, 179.999999),
    (10.0, 180.000001),
    (10.0, 269.999999),
    (10.0, 270.000001),

    # Longitude wrapping
    (10.0, 360.0),
    (10.0, 720.0),
    (10.0, -1.0),
]


print()
print("MOLA BOUNDARY VALIDATION")
print("=" * 72)

passed = 0
failed = 0

for latitude, longitude in tests:

    try:
        tile, row, column = core.pixel_for(
            latitude,
            longitude,
        )

        rows = tile["rows"]
        columns = tile["columns"]

        inside = (
            0 <= row < rows
            and 0 <= column < columns
        )

        if not inside:
            raise RuntimeError(
                f"Pixel outside raster: ({row}, {column})"
            )

        print(
            f"PASS  "
            f"({latitude:11.6f}, {longitude:11.6f})  "
            f"→ {tile['id']:15s} "
            f"pixel=({row:4d},{column:5d})"
        )

        passed += 1

    except Exception as exc:

        print(
            f"FAIL  "
            f"({latitude:11.6f}, {longitude:11.6f})  "
            f"→ {exc}"
        )

        failed += 1


print()
print("=" * 72)
print(f"Passed : {passed}")
print(f"Failed : {failed}")

if failed:
    raise SystemExit(1)

print("✅ ALL MOLA BOUNDARY TESTS PASSED")
