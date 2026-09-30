#!/usr/bin/env python3
"""Check planning artifacts without claiming product verification."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
spec = ROOT / "docs/spec"
ready = json.loads((spec / "readiness.json").read_text())
assert ready["schemaVersion"] == 1
assert ready["implementationModel"] == "gpt-6.1-sol"
assert ready["implementationReasoning"] == "high"
for name in ready["documents"]:
    assert (spec / name).is_file(), name
required = {f"R-{i:02}" for i in range(1, 33)}
requirements = (spec / "requirements.md").read_text()
acceptance = (spec / "acceptance.md").read_text()
assert required <= set(re.findall(r"R-\d\d", requirements))
assert required <= set(re.findall(r"R-\d\d", acceptance))
plan = (spec / "implementation-plan.md").read_text()
assert set(re.findall(r"^## (P\d\d) —", plan, re.M)) == {f"P{i:02}" for i in range(1, 11)}
assert {f"D-{i:02}" for i in range(1, 9)} <= set(re.findall(r"D-\d\d", (spec / "boundary-decisions.md").read_text()))
assert {f"A{i:02}" for i in range(33, 50)} <= set(re.findall(r"A\d\d", acceptance))
for path in [ROOT / "README.md", *spec.glob("*.md"), ROOT / "docs/work-plan.md"]:
    text = path.read_text()
    assert text.endswith("\n"), path
    assert text.count("```") % 2 == 0, f"Unbalanced code fence: {path}"
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    for target in re.findall(r"\]\(([^)]+)\)", prose):
        if "://" not in target and not target.startswith("#"):
            assert (path.parent / target.split("#")[0]).exists(), (path, target)
html = (ROOT / "docs/overview.html").read_text()
assert 'data-plantuml-contract="2"' in html
assert "GPT 6.1 Sol" in html
assert "<title>説明資料の題名</title>" not in html
schema = json.loads((spec / "dashboard.schema.json").read_text())
example = json.loads((spec / "snapshot-example.json").read_text())
assert set(schema["required"]) == set(example)
assert example["reliability24h"]["evaluated"] == 30
assert example["reliability24h"]["successRate"] == 0.8
assert len(schema["$defs"]["warning"]["oneOf"][0]["properties"]["code"]["enum"]) == 30
assert schema["$defs"]["current"]["properties"]["elapsedMs"]["anyOf"][0]["minimum"] == 0
assert len(schema["oneOf"]) == 2
assert '"failureRate"' not in json.dumps(schema)
assert '"proAllowanceProxy"' not in json.dumps(schema)
if ready["ready"]:
    assert ready["consultResult"] is not None
    assert ready["status"] == "ready"
    assert ready["consultResult"]["githubVerification"] == "pass"
    assert ready["consultResult"]["terminalCapture"] == "completed"
    assert ready["blockingItem"] is None
    assert ready["implementationStarted"] is False
else:
    assert ready["blockingItem"]
print(f"PASS planning consistency: 32 requirements / 10 steps / 8 boundaries / A01-A49; ready={ready['ready']}")
print("Product behavior, build, typecheck and implementation tests are not performed.")
