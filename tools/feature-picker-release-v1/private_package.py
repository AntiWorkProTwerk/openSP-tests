"""Normalize licensed v5.52 bytes and replay the existing offline package APIs."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import zipfile

STOCK_SHA = "4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80"
ZIP_SHA = "ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5"
R3_SHA = "2740e108d710217a3203b964a9433c123d2bb62800896dc10ae40d13b8b7dbdc"
R3_MANIFEST_SHA = "731690047b26de8d443441626bae8632f3e4f975d987abd43902a8353b45a061"
SIZE = 2652672


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def need(value, message):
    if not value:
        raise ValueError(message)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def official_bytes(path):
    need(path.stat().st_size in (SIZE, 1966465), "Official input has an unexpected file extent")
    raw = path.read_bytes()
    if digest(raw) == ZIP_SHA:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [row for row in archive.infolist()
                       if row.filename.rsplit("/", 1)[-1] == "SP404MKII_APP1.bin"]
            need(len(members) == 1 and members[0].file_size == SIZE,
                 "Official ZIP must have one exact APP1 member")
            stock = archive.read(members[0])
        kind = "official-v552-zip"
    else:
        stock, kind = raw, "official-v552-app1"
    need(len(stock) == SIZE and digest(stock) == STOCK_SHA,
         "Supply the pinned official Roland v5.52 ZIP or its unchanged APP1 BIN")
    return stock, {"kind": kind, "input_sha256": digest(raw), "input_bytes": len(raw),
                   "official_app1_sha256": STOCK_SHA, "official_app1_bytes": SIZE}


def normalize(synth, official, out):
    stock, proof = official_bytes(official)
    main = synth.parent / "sp404mk2"
    manifest_path = main / "custom_firmware/build/spin_r3/manifest.json"
    manifest_raw = manifest_path.read_bytes()
    need(digest(manifest_raw) == R3_MANIFEST_SHA, "Pinned R3 derivation manifest changed")
    manifest = json.loads(manifest_raw)
    r3 = (main / "custom_firmware/build/spin_r3/candidate/SP404MKII_APP1.bin").read_bytes()
    need(len(r3) == SIZE and digest(r3) == R3_SHA, "Pinned internal R3 bytes changed")
    image, spans = bytearray(stock), []
    for row in manifest["patch_ranges"]:
        start, size = row["offset"], row["size"]
        need(type(start) is int and type(size) is int and 0 <= start < start + size <= SIZE,
             "R3 patch extent is invalid")
        need(all(start + size <= old[0] or old[1] <= start for old in spans),
             "R3 patch extents overlap")
        payload = r3[start:start + size]
        need(digest(payload) == row["sha256"], "R3 patch payload pin differs")
        image[start:start + size] = payload
        spans.append((start, start + size))
    need(len(spans) == 7 and bytes(image) == r3, "Official-to-R3 complete replay differs")
    with out.open("xb") as stream:
        stream.write(image)
    return {**proof, "r3_sha256": digest(image), "r3_bytes": len(image),
            "r3_manifest_sha256": R3_MANIFEST_SHA, "patch_interval_count": len(spans),
            "status": "PASS_SUPPLIED_OFFICIAL_TO_PINNED_R3", "device_operations": False}


def owned(synth, value):
    path = (synth / value).resolve()
    need(path.is_relative_to((synth / "build").resolve()), "Package input escapes private build/")
    return path


def replay(synth, baseline, report_path, out):
    report = json.loads(report_path.read_text())
    family_pin = report["source_family"]
    family_path = owned(synth, family_pin["path"])
    need(digest(family_path.read_bytes()) == family_pin["sha256"], "Family pin differs")
    validator = load(synth / "diagnostics/source16_local_build_v1/validate_family.py", "picker_strict_family")
    validation = validator.validate_family(family_path, family_pin["sha256"])
    need(validation["status"] == "PASS_SOURCE16_LOCAL_FRESH_FAMILY", "Strict local family refused")
    sys.path.insert(0, str(synth / "diagnostics/source16_delivery_family_v2"))
    successor = load(synth / "diagnostics/source16_delivery_family_v2/successor.py", "picker_successor")
    successor.checked_engine(synth / "build/source16-delivery-family-v2/engine-01")
    receipt_pin = report["package"]["receipt"]
    receipt_raw = owned(synth, receipt_pin["path"]).read_bytes()
    need(digest(receipt_raw) == receipt_pin["sha256"], "Receipt pin differs")
    receipt = json.loads(receipt_raw)
    need(receipt["source_family"]["source_family_sha256"] == family_pin["sha256"],
         "Receipt selects another family")
    prepared = owned(synth, report["prepared"]["path"])
    recipe_raw = (prepared / "package/recipe.json").read_bytes()
    module_raw = (owned(synth, report["source"]["path"]) / "module.bin").read_bytes()
    source_manifest_raw = (owned(synth, report["source"]["path"]) / "manifest.json").read_bytes()
    need(digest(recipe_raw) == report["prepared"]["recipe_sha256"] and
         digest(module_raw) == report["source"]["bin_sha256"] and
         digest(source_manifest_raw) == report["source"]["manifest_sha256"], "Build artifact pin differs")
    base = baseline.read_bytes()
    need(digest(base) == R3_SHA, "Supplied-file-derived R3 baseline changed")
    full = load(synth / "tools/package_synth_full_b2.py", "picker_full_b2")
    pins = full.Pins()
    lock, legacy, bridge_test, host, fake, internal_base, tail, hook, symbols = full.dependencies(pins)
    need(base == internal_base, "Supplied-file-derived baseline differs from pinned dependency")
    provenance, stock_rows = legacy.stock(pins)
    source, writes = legacy.apply_recipe(base, json.loads(recipe_raw), stock_rows, json.loads(source_manifest_raw))
    need(source == (prepared / "package/source_APP1.bin").read_bytes(), "Native recipe replay differs")
    image, title, placement = full.make_image(source, base, module_raw, tail, hook, symbols,
                                            receipt["candidate"]["identity"], writes, host)
    candidate_pin = report["package"]["candidate"]
    existing = owned(synth, candidate_pin["path"]).read_bytes()
    need(image == existing and digest(image) == candidate_pin["sha256"] == receipt["candidate"]["sha256"],
         "Supplied-file package replay differs from the authenticated disabled package")
    need(len(image) == candidate_pin["bytes"] == receipt["candidate"]["bytes"], "Candidate extent differs")
    pins.recheck()
    with out.open("xb") as stream:
        stream.write(image)
    return {"status": "PASS_SUPPLIED_BASE_NATIVE_RECIPE_AND_B2_REPLAY",
            "candidate_sha256": digest(image), "candidate_bytes": len(image),
            "recipe_sha256": digest(recipe_raw), "module_sha256": digest(module_raw),
            "source_family_sha256": family_pin["sha256"], "family_validation": validation,
            "builder_recompiled": False, "delivery": "DO_NOT_DELIVER", "device_operations": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synth-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--official-base", type=Path)
    group.add_argument("--build-report", type=Path)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    synth, out = args.synth_root.resolve(), args.out.resolve()
    need(out.is_relative_to((synth / "build/feature-picker-release-v1").resolve()),
         "Outputs must stay in the private feature-picker build area")
    if args.official_base:
        result = normalize(synth, args.official_base.resolve(), out)
    else:
        need(args.baseline is not None, "Replay needs a supplied-file-derived baseline")
        result = replay(synth, args.baseline.resolve(), args.build_report.resolve(), out)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
