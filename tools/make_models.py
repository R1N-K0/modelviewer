"""Builds static/models/*.glb from the Stanford scans and the three.js teapot. Run once; the
GLBs are committed so the viewer's clones need no pip.

    .venv\\Scripts\\python tools\\make_models.py
"""

import io
import json
from pathlib import Path
import struct
import subprocess
import tarfile
import urllib.request

import fast_simplification
import numpy as np
import pymeshfix
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
import trimesh

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
DOWNLOAD = TOOLS / "_download"
OUT = ROOT / "static" / "models"

MAX_BYTES = 5 * 1024 * 1024

# How far MeshFix may move the scanned surface, as a share of the longest side, and how many of
# the scan's vertices are measured for it.
MAX_REPAIR_SHIFT = 0.01
REPAIR_SAMPLES = 10_000

# The most segments per patch that keeps the teapot within 50,000 triangles (49,952).
TEAPOT_SEGMENTS = 28

# name: (url, member inside the tarball, triangles to keep or None for all, close the holes).
# Both scans are Y up already. The bunny's base was never scanned and shows as holes when it is
# turned over; MeshFix closes them. The dragon is left as it is.
SCANS = {
    "dragon": (
        "http://graphics.stanford.edu/pub/3Dscanrep/dragon/dragon_recon.tar.gz",
        "dragon_recon/dragon_vrip.ply",
        150_000,
        False,
    ),
    "bunny": (
        "http://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz",
        "bunny/reconstruction/bun_zipper.ply",
        None,
        True,
    ),
}


def fetch(url, member):
    """The source file on disk, downloaded once.

    Only the one member is read out of the tarball, so nothing in it decides where files land.
    """
    DOWNLOAD.mkdir(parents=True, exist_ok=True)
    target = DOWNLOAD / Path(member).name
    if target.exists():
        return target
    print(f"downloading {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        data = tar.extractfile(member).read()
    target.write_bytes(data)
    return target


def load(path):
    loaded = trimesh.load(path, process=False)
    return trimesh.Trimesh(vertices=loaded.vertices, faces=loaded.faces, process=True)


def teapot():
    """three.js's TeapotGeometry, with the bottom on and the lid seated on the rim.

    It is Y up with the spout towards +X. Its patches share no vertices, so they are merged here.
    """
    out = subprocess.run(
        ["node", "teapot.mjs", str(TEAPOT_SEGMENTS)],
        cwd=TOOLS, capture_output=True, check=True, text=True,
    ).stdout
    data = json.loads(out)
    vertices = np.array(data["positions"], dtype=np.float64).reshape(-1, 3)
    faces = np.array(data["index"], dtype=np.int64).reshape(-1, 3)
    return cap_spout(trimesh.Trimesh(vertices=vertices, faces=faces, process=True))


def cap_spout(mesh):
    """The teapot with the mouth of its spout closed by a fan round the mouth's centre.

    The model stands for a solid object, which has no opening there. The other rims stay open:
    the lid's lies on the body's own rim, and the spout and handle ends sit inside the body.
    MeshFix is not used, since it would also rework where the lid meets the rim.
    """
    before = boundary_edges(mesh)
    edges = mesh.edges[trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)]
    graph = coo_matrix(
        (np.ones(len(edges)), (edges[:, 0], edges[:, 1])),
        shape=(len(mesh.vertices), len(mesh.vertices)),
    )
    _, label = connected_components(graph, directed=False)
    loops = [edges[label[edges[:, 0]] == value] for value in np.unique(label[edges[:, 0]])]
    mouth = max(loops, key=lambda loop: mesh.vertices[np.unique(loop)].mean(axis=0)[0])

    centre = len(mesh.vertices)
    vertices = np.vstack([mesh.vertices, mesh.vertices[np.unique(mouth)].mean(axis=0)])
    # Each rim edge runs one way in the face beside it; the cap takes it the other way, so the
    # two faces agree on which side is out.
    fan = np.column_stack([mouth[:, 1], mouth[:, 0], np.full(len(mouth), centre)])
    capped = trimesh.Trimesh(vertices=vertices, faces=np.vstack([mesh.faces, fan]), process=True)
    print(
        f"teapot spout: boundary edges {before:,} -> {boundary_edges(capped):,}, "
        f"{len(mouth)} rim edges closed, winding consistent {capped.is_winding_consistent}",
        flush=True,
    )
    return capped


def boundary_edges(mesh):
    """Edges with a face on one side only: the rims of the holes."""
    return len(trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1))


def close(mesh, name):
    """The mesh with its holes closed, checked against the scan it came from.

    MeshFix may nudge vertices while it works, so the scan's own vertices are measured against
    the closed surface; a closed mesh that drifted from the scan is not the bunny any more.
    """
    fix = pymeshfix.MeshFix(mesh.vertices, mesh.faces)
    fix.repair()
    closed = trimesh.Trimesh(vertices=fix.points, faces=fix.faces, process=True)

    rng = np.random.default_rng(0)
    picked = rng.choice(len(mesh.vertices), min(REPAIR_SAMPLES, len(mesh.vertices)), replace=False)
    _, distance, _ = trimesh.proximity.closest_point(closed, mesh.vertices[picked])
    distance = distance / (mesh.bounds[1] - mesh.bounds[0]).max()
    print(
        f"{name} MeshFix: boundary edges {boundary_edges(mesh):,} -> {boundary_edges(closed):,}, "
        f"watertight {mesh.is_watertight} -> {closed.is_watertight}, "
        f"shift from the scan (longest side 1.0) max {distance.max():.2e} "
        f"p99 {np.percentile(distance, 99):.2e} over {len(picked):,} vertices",
        flush=True,
    )
    if distance.max() > MAX_REPAIR_SHIFT:
        raise SystemExit(f"{name}: MeshFix moved the surface by {distance.max():.5f}, over {MAX_REPAIR_SHIFT}")
    return closed


def simplify(mesh, target):
    if target is None or len(mesh.faces) <= target:
        return mesh
    points, triangles = fast_simplification.simplify(
        mesh.vertices, mesh.faces, target_count=target
    )
    return trimesh.Trimesh(vertices=points, faces=triangles, process=True)


def normalize(mesh):
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


def meshes():
    for name, (url, member, target, closing) in SCANS.items():
        mesh = load(fetch(url, member))
        if closing:
            mesh = close(mesh, name)
        yield name, simplify(mesh, target)
    yield "teapot", teapot()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, mesh in meshes():
        mesh = normalize(mesh)
        path = OUT / f"{name}.glb"
        mesh.export(path, file_type="glb", include_normals=True)
        size = path.stat().st_size
        if not has_normals(path):
            raise SystemExit(f"{path}: no NORMAL in the GLB")
        if size > MAX_BYTES:
            raise SystemExit(f"{path}: {size} bytes, over {MAX_BYTES}")
        rows.append((name, len(mesh.faces), len(mesh.vertices), size, mesh.is_watertight, boundary_edges(mesh)))

    print(f"{'name':<8}{'triangles':>11}{'vertices':>10}{'bytes':>11}{'watertight':>12}{'boundary edges':>16}")
    for name, faces, vertices, size, watertight, edges in rows:
        print(f"{name:<8}{faces:>11,}{vertices:>10,}{size:>11,}{str(watertight):>12}{edges:>16,}")


if __name__ == "__main__":
    main()
