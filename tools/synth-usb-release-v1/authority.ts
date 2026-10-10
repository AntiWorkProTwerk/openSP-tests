// Retained evidence trust anchors. Candidate authorities are deliberately empty.
export const P6S_IMAGE = Object.freeze({
  "sha256": "7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60",
  "bytes": 2741144,
  "crc32": 3127470002,
  "padded_bytes": 2744320,
  "sectors": 670,
  "abi": 2,
  "expected_normal_identity": "SYNTH P6S!",
  "expected_cold_del_marker": 1380057601
} as const);
export const P6S_EVIDENCE = Object.freeze([
  {
    "id": "usb-storage",
    "path": "evidence/hardware/p6s_usb_01.json",
    "bytes": 4755,
    "sha256": "e04ed995fda8054825e0c2e5ea8dc5a555f1ec6025e3682dfc1bab144d01d161"
  },
  {
    "id": "owner-normal",
    "path": "evidence/hardware/p6s_owner_results_01.json",
    "bytes": 723,
    "sha256": "5c39e716f77a429feed1c0da05a73d8beb8e9776efdd3cd396dd1a50b73697e5"
  },
  {
    "id": "owner-sample",
    "path": "evidence/hardware/p6s_owner_results_05.json",
    "bytes": 444,
    "sha256": "447173d940d0573ee190d84f35a6a6f569d5d53a9e4e96c174e24b96c989fb45"
  },
  {
    "id": "post-del",
    "path": "evidence/hardware/p6s_post_del_01.json",
    "bytes": 3474,
    "sha256": "3da6deae5fb88dbf40de6daeb63bf92da7f789983fff7337f051f857f84babf2"
  },
  {
    "id": "normal-link",
    "path": "build/reentry-host-worker-20261003-1/reentry_p2_host/reentry-host-trial-normal-1/normal.json",
    "bytes": 1153,
    "sha256": "2f1d9067478d7f1de5f7ec9b609aae0e3884d7985c81a054ebded4fbf0038239"
  },
  {
    "id": "source-whole",
    "path": "build/standalone-source-picker-v1/whole-02/REPORT.json",
    "bytes": 14061,
    "sha256": "00e63d789ac9bcc34ab43a9062ac7456aee032691df5b8e73d458c5d482f6ee7"
  },
  {
    "id": "source-restore",
    "path": "build/standalone-source-picker-v1/whole-02/restore-build/REPORT.json",
    "bytes": 1359,
    "sha256": "97f996e157987154b0887491f180fd5581d6fb3405ff398f28827f71fdc8faf0"
  },
  {
    "id": "historical-package",
    "path": "build/p6r-reentry-p2-package-1/manifest.json",
    "bytes": 71250,
    "sha256": "a8d0b8528118eb2f4cb92f02cff5a01bc5fd80d8eb3278ebfe66d90a37b6e541"
  },
  {
    "id": "historical-review",
    "path": "build/p6s-root-review-1/report.json",
    "bytes": 75425,
    "sha256": "f2fd444d8d7be17ddfd9adf8a815e51a6b6faa87b6637ed22bdbc4805dd2c174"
  },
  {
    "id": "browser-profile",
    "path": "../sp404mk2/analysis/hardware/b2_webhid_readonly_20261005T2209Z/browser-result.json",
    "bytes": 1068,
    "sha256": "a354c9e95ff692ce15ffccc8da571b7ce6eac3b352cc6e3dd452435826c95487"
  },
  {
    "id": "browser-review",
    "path": "../sp404mk2/analysis/hardware/b2_webhid_readonly_20261005T2209Z/REVIEW.json",
    "bytes": 2059,
    "sha256": "8cb0be9834104e4f935c57e6a1128074e906716e9a324294adfd0242dd36cc9c"
  },
  {
    "id": "physical-review",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/ROUNDTRIP_REVIEW.json",
    "bytes": 2096,
    "sha256": "3849470e893c5e49767b25312cbe4f4b08442988ce01c0d184603120eb4d0e79"
  },
  {
    "id": "physical-preflight",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/browser-preflight-01.json",
    "bytes": 9330,
    "sha256": "f8b1fa67d4b495a7323fca52d31ddff150d0f0bf712ee5b65d989d9de3e7970d"
  },
  {
    "id": "physical-storage",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/browser-storage-01.json",
    "bytes": 117545,
    "sha256": "090872342cc913029ca9f5ba5005ee2606dc4399df99710a9029b2557f4e97ac"
  },
  {
    "id": "root-browser-observation",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/ROOT_STORAGE_REVIEW.json",
    "bytes": 1174,
    "sha256": "d9d44a7ab5c040075288ba39655e8389e41618f1232fd87708bc0d35c1035782"
  },
  {
    "id": "owner-reboot",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/OWNER_BOOT_RESULTS.json",
    "bytes": 1243,
    "sha256": "bf93674a3ef3b3d92a45e9e7e1b8091a3d0d51ad92052a05351d89f49fbfa0dc"
  },
  {
    "id": "fresh-del-result",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/fresh-del-status-01/RESULT.json",
    "bytes": 1656,
    "sha256": "55ab2667e4f1793bc6350e6a9b27f42ba1854f688b802aac993709138a35cf61"
  },
  {
    "id": "fresh-del-journal",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/fresh-del-status-01/transport.jsonl",
    "bytes": 3399,
    "sha256": "d397c61025cb5025bbc995b922cea782ad7308ad68dfb4a62614249b20f91f20"
  },
  {
    "id": "fresh-del-source",
    "path": "../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/read_fresh_del.py",
    "bytes": 2578,
    "sha256": "cb8acc49a7dc6d87ee3acaf4d10d77f8696bc0f5caa3b27e58f937c9b28ca380"
  },
  {
    "id": "physical-preparation",
    "path": "build/browser-p6s-roundtrip-v1/2026-10-06T02-46-49.851Z/PREPARATION.json",
    "bytes": 5053,
    "sha256": "f59dfb10dd1155e429c7d23922ee7a15de6d5155a34c632f9ab4ebb97834fa72"
  },
  {
    "id": "additive-offline-review",
    "path": "diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/PHYSICAL_ROUNDTRIP_REVIEW_01.json",
    "bytes": 11135,
    "sha256": "c954d5bcad0d12331af74451cd759cad80ed62eb6cbb3b0060741760ffcf6242"
  }
].map(pin => Object.freeze(pin)));
export const CANDIDATE_AUTHORITIES: readonly never[] = Object.freeze([]);
