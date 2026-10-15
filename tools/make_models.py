"""Builds static/models/*.glb from the original scans. Run once; the GLBs are committed so
the viewer's clones need no pip.

    .venv\\Scripts\\python tools\\make_models.py
"""

import io
import json
import logging
from pathlib import Path
import struct
import tarfile
import urllib.request

import fast_simplification
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD = ROOT / "tools" / "_download"
OUT = ROOT / "static" / "models"

MAX_BYTES = 5 * 1024 * 1024

# Without scipy, trimesh logs a traceback each time it falls back to its slower vertex normals,
# whose result is the same. scipy is not worth installing for three meshes.
logging.getLogger("trimesh").setLevel(logging.ERROR)

# name: (url, member inside the tarball or None, triangles to keep or None for all)
SOURCES = {
    "dragon": (
        "http://graphics.stanford.edu/pub/3Dscanrep/dragon/dragon_recon.tar.gz",
        "dragon_recon/dragon_vrip.ply",
        150_000,
    ),
    "bunny": (
        "http://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz",
        "bunny/reconstruction/bun_zipper.ply",
        None,
    ),
    "teapot": (
        "https://graphics.cs.utah.edu/courses/cs6620/fall2013/prj05/teapot.obj",
        None,
        50_000,
    ),
}

# The Utah file is Z up with the spout towards +X. The Stanford scans are already Y up.
TO_Y_UP = {
    "teapot": trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]),
}


def fetch(name, url, member):
    """The source file on disk, downloaded once.

    Only the one member is read out of the tarball, so nothing in it decides where files land.
    """
    DOWNLOAD.mkdir(parents=True, exist_ok=True)
    target = DOWNLOAD / (Path(member).name if member else Path(url).name)
    if target.exists():
        return target
    print(f"downloading {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if member:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            data = tar.extractfile(member).read()
    target.write_bytes(data)
    return target


def load(path):
    """Positions and triangles only.

    The teapot's OBJ carries UVs, and trimesh splits a vertex wherever its UV differs; the
    normals would then break along those seams. Rebuilding from bare positions merges them.
    Its material is never copied either: force="mesh" would copy it, which needs Pillow.
    """
    loaded = trimesh.load(path, process=False)
    return trimesh.Trimesh(vertices=loaded.vertices, faces=loaded.faces, process=True)


def simplify(mesh, target):
    if target is None or len(mesh.faces) <= target:
        return mesh
    points, triangles = fast_simplification.simplify(
        mesh.vertices, mesh.faces, target_count=target
    )
    return trimesh.Trimesh(vertices=points, faces=triangles, process=True)


def normalize(mesh, name):
    if name in TO_Y_UP:
        mesh.apply_transform(TO_Y_UP[name])
    low, high = mesh.bounds
    mesh.apply_translation(-(low + high) / 2)
    mesh.apply_scale(1.0 / (high - low).max())
    return mesh


def has_normals(path):
    """Read back from the written GLB, so the check does not depend on what trimesh exports by default."""
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    return all("NORMAL" in p["attributes"] for m in gltf["meshes"] for p in m["primitives"])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, (url, member, target) in SOURCES.items():
        mesh = normalize(simplify(load(fetch(name, url, member)), target), name)
        path = OUT / f"{name}.glb"
        mesh.export(path, file_type="glb", include_normals=True)
        size = path.stat().st_size
        if not has_normals(path):
            raise SystemExit(f"{path}: no NORMAL in the GLB")
        if size > MAX_BYTES:
            raise SystemExit(f"{path}: {size} bytes, over {MAX_BYTES}")
        rows.append((name, len(mesh.faces), len(mesh.vertices), size))

    print(f"{'name':<8}{'triangles':>11}{'vertices':>10}{'bytes':>11}")
    for name, faces, vertices, size in rows:
        print(f"{name:<8}{faces:>11,}{vertices:>10,}{size:>11,}")


if __name__ == "__main__":
    main()
