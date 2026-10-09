//! Every vector the TypeScript reference wrote must come out of the crate exactly.
//! Regenerate with `npm run integrity:vectors` after changing src/agent/integrityReference.ts.
use pzm_integrity::{check_json, Report};
use std::fs;
use std::path::Path;

#[test]
fn matches_typescript_reference() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("vectors");
    let mut files: Vec<_> = fs::read_dir(&dir).expect("vectors dir").filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map_or(false, |x| x == "json")).collect();
    files.sort();
    assert!(files.len() >= 40, "expected the generated vectors, found {}", files.len());
    let mut failures = Vec::new();
    for f in &files {
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(f).unwrap()).unwrap();
        let input = serde_json::to_string(&v["input"]).unwrap();
        let expected: Report = serde_json::from_value(v["expected"].clone()).unwrap();
        match check_json(&input) {
            Ok(got) if got == expected => {}
            Ok(got) => failures.push(format!("{}:\n  expected {}\n  got      {}", f.display(), serde_json::to_string(&expected).unwrap(), serde_json::to_string(&got).unwrap())),
            Err(e) => failures.push(format!("{}: {}", f.display(), e)),
        }
    }
    assert!(failures.is_empty(), "{} of {} vectors differ:\n{}", failures.len(), files.len(), failures.join("\n"));
}

#[test]
fn every_invariant_is_exercised() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("vectors");
    let mut seen = std::collections::HashSet::new();
    for e in fs::read_dir(&dir).unwrap().flatten() {
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(e.path()).unwrap()).unwrap();
        for f in v["expected"]["findings"].as_array().unwrap() {
            seen.insert(f["ruleId"].as_str().unwrap().to_string());
        }
    }
    for inv in pzm_integrity::INVARIANTS {
        assert!(seen.contains(inv), "{} has no vector", inv);
    }
}
