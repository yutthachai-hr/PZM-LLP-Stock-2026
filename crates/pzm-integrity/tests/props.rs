//! G21 — property tests for the Rust engine, on seeded random snapshots.
//!
//! No property-testing crate: a small xorshift generator keeps the crate's only dependencies
//! serde and serde_json. Every run uses the same seeds, so a failure names its case.
use pzm_integrity::{check, check_json, Snapshot};
use serde_json::{json, Value};
use std::collections::BTreeMap;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<'a>(&mut self, xs: &'a [&'a str]) -> &'a str {
        xs[self.below(xs.len() as u64) as usize]
    }
}

const LOCS: [&str; 3] = ["wh", "br1", "br2"];
const PRODUCTS: [&str; 3] = ["p1", "p2", "p3"];

/// Random movements in whole units (exact sums), with levels caught up with the ledger.
fn consistent(rng: &mut Rng) -> Value {
    let n = rng.below(40) as usize;
    let mut ledger: BTreeMap<String, i64> = BTreeMap::new();
    let mut movements = Vec::new();
    for i in 0..n {
        let p = rng.pick(&PRODUCTS).to_string();
        let qty = (rng.below(500) + 1) as i64;
        let from = if rng.below(2) == 0 { Some(rng.pick(&LOCS).to_string()) } else { None };
        let to = if rng.below(2) == 0 { Some(rng.pick(&LOCS).to_string()) } else { None };
        let voided = rng.below(10) == 0;
        if !voided {
            if let Some(f) = &from {
                *ledger.entry(format!("{}__{}", f, p)).or_default() -= qty;
            }
            if let Some(t) = &to {
                *ledger.entry(format!("{}__{}", t, p)).or_default() += qty;
            }
        }
        let mut m = json!({ "id": format!("m{}", i), "productId": p, "qty": qty, "date": 1.0, "createdAt": 1.0, "voided": voided });
        if let Some(f) = from {
            m["fromLocationId"] = json!(f);
        }
        if let Some(t) = to {
            m["toLocationId"] = json!(t);
        }
        movements.push(m);
    }
    let levels: Vec<Value> = ledger.iter().map(|(id, q)| json!({ "id": id, "qty": *q as f64 })).collect();
    json!({
        "schema": "pzm-integrity/1",
        "products": PRODUCTS.iter().map(|p| json!({ "id": p, "unitType": "KG" })).collect::<Vec<_>>(),
        "locations": LOCS.iter().map(|l| json!({ "id": l })).collect::<Vec<_>>(),
        "levels": levels,
        "movements": movements,
        "orders": [], "transfers": [], "closedPeriods": []
    })
}

fn snap(v: &Value) -> Snapshot {
    serde_json::from_value(v.clone()).expect("generated snapshot parses")
}

#[test]
fn caught_up_levels_never_drift() {
    for seed in 1..=500u64 {
        let mut rng = Rng(seed * 0x9E37_79B9_7F4A_7C15);
        let v = consistent(&mut rng);
        let drift: Vec<_> = check(&snap(&v)).findings.into_iter().filter(|f| f.rule_id == "INV.LEVEL_EQ_LEDGER").collect();
        assert!(drift.is_empty(), "seed {}: {:?}", seed, drift);
    }
}

#[test]
fn one_changed_level_is_reported_exactly() {
    for seed in 1..=500u64 {
        let mut rng = Rng(seed * 0xD1B5_4A32_D192_ED03);
        let mut v = consistent(&mut rng);
        let levels = v["levels"].as_array_mut().unwrap();
        if levels.is_empty() {
            continue;
        }
        let i = (rng.below(levels.len() as u64)) as usize;
        let id = levels[i]["id"].as_str().unwrap().to_string();
        let q = levels[i]["qty"].as_f64().unwrap();
        levels[i]["qty"] = json!(q + (rng.below(100) + 1) as f64);
        let drift: Vec<_> = check(&snap(&v)).findings.into_iter().filter(|f| f.rule_id == "INV.LEVEL_EQ_LEDGER").map(|f| f.entity).collect();
        assert_eq!(drift, vec![id], "seed {}", seed);
    }
}

#[test]
fn movement_order_does_not_change_the_report() {
    for seed in 1..=300u64 {
        let mut rng = Rng(seed * 0xA076_1D64_78BD_642F);
        let v = consistent(&mut rng);
        let mut w = v.clone();
        let ms = w["movements"].as_array_mut().unwrap();
        for i in (1..ms.len()).rev() {
            let j = rng.below((i + 1) as u64) as usize;
            ms.swap(i, j);
        }
        assert_eq!(check(&snap(&v)), check(&snap(&w)), "seed {}", seed);
    }
}

#[test]
fn never_panics_on_odd_but_well_formed_input() {
    for seed in 1..=300u64 {
        let mut rng = Rng(seed * 0xE703_7ED1_A0B4_28DB);
        let mut v = consistent(&mut rng);
        // Odd shapes: a transit location, a missing product, NaN and zero rates, a lock.
        v["movements"].as_array_mut().unwrap().push(json!({ "id": "odd", "productId": "ghost", "qty": 1, "fromLocationId": "transit", "toLocationId": "nowhere", "date": 0.0, "createdAt": 9e12, "transferId": "t?", "operationId": "" }));
        v["products"].as_array_mut().unwrap().push(json!({ "id": "px", "unitType": "", "unitConversions": [{ "label": "", "size": null }, { "label": "Box", "size": 0, "of": "Box" }] }));
        v["closedPeriods"] = json!([{ "locationId": "wh", "month": "1970-01", "postedAt": 0.0 }]);
        let report = check_json(&v.to_string()).expect("well-formed input never errors");
        assert!(["PASS", "WARNING", "FAIL"].contains(&report.status.as_str()));
    }
}

#[test]
fn malformed_input_is_an_error_not_a_panic() {
    for bad in ["", "{", "[]", "{\"schema\":\"pzm-integrity/2\"}", "{\"schema\":\"pzm-integrity/1\",\"products\":1}"] {
        assert!(check_json(bad).is_err(), "{:?}", bad);
    }
}
