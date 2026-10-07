//! G13 — PZM stock integrity invariants.
//!
//! A pure mirror of `src/agent/integrityReference.ts`: same snapshot in, same report out,
//! byte for byte (checked by `tests/vectors.rs` against vectors the TypeScript writes).
//! No I/O, no clock, no network. Not on any request path: CI, offline reconciliation,
//! shadow auditing and release verification.
//!
//! Where JavaScript and Rust differ, this follows JavaScript:
//!  - rounding is `Math.round` (half toward +infinity), not `f64::round`;
//!  - numbers print as `String(n)` does: no negative zero, `NaN`, `Infinity`;
//!  - maps iterate in insertion order where the sum depends on order.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{HashMap, HashSet};

pub const SCHEMA: &str = "pzm-integrity/1";
pub const TRANSIT: &str = "transit";
const EPS: f64 = 0.0005;
const BKK_OFFSET_MS: i64 = 7 * 3_600_000;
const DAY_MS: i64 = 86_400_000;
const MAX_CHAIN: usize = 6;

pub const INVARIANTS: [&str; 10] = [
    "INV.LEVEL_EQ_LEDGER",
    "INV.NO_NEGATIVE_LEDGER",
    "INV.PO_RECEIVED_EQ_RECEIPTS",
    "INV.NO_DUPLICATE_RECEIPT_OP",
    "INV.TRANSFER_CONSERVATION",
    "INV.TRANSIT_EQ_OPEN_TRANSFERS",
    "INV.UNIT_CONVERSION_VALID",
    "INV.NO_ORPHAN_LEDGER",
    "INV.AVAILABLE_LE_ONHAND",
    "INV.PERIOD_LOCK_CONSISTENT",
];
const OPEN_TRANSFER: [&str; 4] = ["inTransit", "receiving", "discrepancy", "pendingDiscrepancyApproval"];
const CLOSED_TRANSFER: [&str; 4] = ["completed", "resolved", "cancelled", "rejected"];

// ------------------------------------------------------------------ input ----

/// JSON has no NaN: the TypeScript writes a NaN rate as `null`, which reads back as NaN here.
fn nan_if_null<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.unwrap_or(f64::NAN))
}

#[derive(Debug, Clone, Deserialize)]
pub struct Conversion {
    pub label: String,
    #[serde(deserialize_with = "nan_if_null")]
    pub size: f64,
    pub per: Option<f64>,
    pub of: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub unit_type: String,
    #[serde(default)]
    pub unit_conversions: Vec<Conversion>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Location {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Level {
    pub id: String,
    pub qty: f64,
    pub reserved: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    pub id: String,
    pub product_id: String,
    pub qty: f64,
    pub from_location_id: Option<String>,
    pub to_location_id: Option<String>,
    pub date: f64,
    pub created_at: f64,
    #[serde(default)]
    pub voided: bool,
    pub operation_id: Option<String>,
    pub po_id: Option<String>,
    pub transfer_id: Option<String>,
    pub lock_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderLine {
    pub product_id: String,
    pub received_qty: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    pub status: String,
    pub location_id: String,
    pub lines: Vec<OrderLine>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: String,
    pub status: String,
    pub from_location_id: String,
    pub to_location_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedPeriod {
    pub location_id: String,
    pub month: String,
    pub posted_at: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: String,
    pub products: Vec<Product>,
    pub locations: Vec<Location>,
    pub levels: Vec<Level>,
    pub movements: Vec<Movement>,
    pub orders: Vec<Order>,
    pub transfers: Vec<Transfer>,
    pub closed_periods: Vec<ClosedPeriod>,
}

// ------------------------------------------------------------------ output ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub rule_id: String,
    pub severity: String,
    pub entity: String,
    pub expected: String,
    pub actual: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub schema: String,
    pub status: String,
    pub findings: Vec<Finding>,
}

// ------------------------------------------------------------------ JavaScript arithmetic ----

/// `Math.round(n * 1000) / 1000`, with negative zero folded to zero.
pub fn round3(n: f64) -> f64 {
    let x = n * 1000.0;
    let r = if x.is_finite() {
        let f = x.floor();
        if x - f >= 0.5 { f + 1.0 } else { f }
    } else {
        x
    };
    let out = r / 1000.0;
    if out == 0.0 { 0.0 } else { out }
}

/// A finite number as JavaScript's `String(n)` prints it (no exponent within PZM's range).
fn js_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == 0.0 {
        "0".into()
    } else {
        format!("{}", n)
    }
}

pub fn num(n: f64) -> String {
    js_string(round3(n))
}

/// 'YYYY-MM' of the Bangkok day containing `ms`.
pub fn bkk_month(ms: f64) -> String {
    let days = (ms as i64 + BKK_OFFSET_MS).div_euclid(DAY_MS);
    let (y, m, _) = civil_from_days(days);
    format!("{:04}-{:02}", y, m)
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ------------------------------------------------------------------ units (lib/inventoryRules/uom.ts) ----

fn unit_key(u: &str) -> String {
    u.trim().to_lowercase()
}

fn same_unit(a: &str, b: &str) -> bool {
    unit_key(a) == unit_key(b)
}

fn measure_of(unit: &str) -> Option<(u8, f64)> {
    const MASS: [(&str, f64); 10] = [("g", 0.001), ("กรัม", 0.001), ("gram", 0.001), ("grams", 0.001), ("kg", 1.0), ("กก.", 1.0), ("กก", 1.0), ("กิโลกรัม", 1.0), ("kilogram", 1.0), ("kilograms", 1.0)];
    const VOLUME: [(&str, f64); 13] = [
        ("ml", 0.001), ("มล.", 0.001), ("มล", 0.001), ("มิลลิลิตร", 0.001), ("millilitre", 0.001), ("milliliter", 0.001),
        ("l", 1.0), ("lt", 1.0), ("ลิตร", 1.0), ("litre", 1.0), ("liter", 1.0), ("litres", 1.0), ("liters", 1.0),
    ];
    let k = unit_key(unit);
    if let Some((_, s)) = MASS.iter().find(|(n, _)| *n == k) {
        return Some((0, *s));
    }
    VOLUME.iter().find(|(n, _)| *n == k).map(|(_, s)| (1, *s))
}

fn standard_factor(from: &str, to: &str) -> Option<f64> {
    if same_unit(from, to) {
        return Some(1.0);
    }
    match (measure_of(from), measure_of(to)) {
        (Some((ma, sa)), Some((mb, sb))) if ma == mb => Some(sa / sb),
        _ => None,
    }
}

/// How many base units one `entry_unit` is, following chains; None = no rate.
pub fn resolve_factor(product: &Product, entry_unit: &str, depth: usize) -> Option<f64> {
    let base = &product.unit_type;
    if entry_unit.is_empty() || same_unit(entry_unit, base) {
        return Some(1.0);
    }
    if depth > MAX_CHAIN {
        return None;
    }
    let own = product.unit_conversions.iter().find(|c| same_unit(&c.label, entry_unit));
    if let Some(c) = own {
        let per_ok = c.per.map_or(true, |p| p > 0.0);
        if c.size.is_finite() && c.size > 0.0 && per_ok {
            let step = c.size / c.per.unwrap_or(1.0);
            match c.of.as_deref() {
                None | Some("") => return Some(step),
                Some(of) if same_unit(of, base) => return Some(step),
                Some(of) if same_unit(of, entry_unit) => return None,
                Some(of) => return resolve_factor(product, of, depth + 1).map(|rest| step * rest),
            }
        }
    }
    standard_factor(entry_unit, base)
}

// ------------------------------------------------------------------ the check ----

/// A map that remembers insertion order, as JavaScript's `Map` does.
#[derive(Default)]
struct Ordered {
    keys: Vec<String>,
    vals: HashMap<String, f64>,
}

impl Ordered {
    fn get(&self, k: &str) -> f64 {
        *self.vals.get(k).unwrap_or(&0.0)
    }
    fn set(&mut self, k: String, v: f64) {
        if !self.vals.contains_key(&k) {
            self.keys.push(k.clone());
        }
        self.vals.insert(k, v);
    }
    fn add(&mut self, k: String, d: f64) {
        let v = round3(self.get(&k) + d);
        self.set(k, v);
    }
}

fn key(loc: &str, pid: &str) -> String {
    format!("{}__{}", loc, pid)
}

pub fn check(s: &Snapshot) -> Report {
    let mut groups: Vec<Vec<Finding>> = vec![Vec::new(); INVARIANTS.len()];
    let mut add = |rule: usize, severity: &str, entity: String, expected: String, actual: String, reason: String| {
        groups[rule].push(Finding { rule_id: INVARIANTS[rule].into(), severity: severity.into(), entity, expected, actual, reason });
    };
    let live: Vec<&Movement> = s.movements.iter().filter(|m| !m.voided).collect();

    let mut ledger = Ordered::default();
    for m in &live {
        if let Some(f) = m.from_location_id.as_deref().filter(|x| !x.is_empty()) {
            ledger.add(key(f, &m.product_id), -m.qty);
        }
        if let Some(t) = m.to_location_id.as_deref().filter(|x| !x.is_empty()) {
            ledger.add(key(t, &m.product_id), m.qty);
        }
    }

    // 1.
    let mut stored: HashMap<&str, &Level> = HashMap::new();
    for l in &s.levels {
        stored.insert(l.id.as_str(), l);
    }
    let mut ids: Vec<String> = ledger.keys.clone();
    let mut seen: HashSet<String> = ids.iter().cloned().collect();
    for l in &s.levels {
        if seen.insert(l.id.clone()) {
            ids.push(l.id.clone());
        }
    }
    for id in &ids {
        let a = ledger.get(id);
        let b = stored.get(id.as_str()).map_or(0.0, |l| l.qty);
        if (a - b).abs() > EPS {
            add(0, "critical", id.clone(), num(a), num(b), "stored balance differs from the ledger".into());
        }
    }
    // 2.
    for id in &ledger.keys {
        let a = ledger.get(id);
        if a < -EPS {
            add(1, "critical", id.clone(), "0".into(), num(a), "ledger balance below zero".into());
        }
    }
    // 3.
    let mut receipts: HashMap<(&str, &str), Vec<f64>> = HashMap::new();
    for m in &live {
        if let Some(po) = m.po_id.as_deref() {
            if m.to_location_id.as_deref().map_or(false, |t| !t.is_empty()) {
                receipts.entry((po, m.product_id.as_str())).or_default().push(m.qty);
            }
        }
    }
    for o in &s.orders {
        for l in &o.lines {
            let mut sum = 0.0;
            for q in receipts.get(&(o.id.as_str(), l.product_id.as_str())).map_or(&[][..], |v| v.as_slice()) {
                sum = round3(sum + q);
            }
            if (sum - l.received_qty).abs() > EPS {
                add(2, "critical", format!("{}/{}", o.id, l.product_id), num(sum), num(l.received_qty), "order line received differs from its receipts".into());
            }
        }
    }
    // 4.
    let mut ops: Vec<(String, Vec<String>)> = Vec::new();
    let mut op_index: HashMap<&str, usize> = HashMap::new();
    for m in &live {
        if let Some(op) = m.operation_id.as_deref().filter(|x| !x.is_empty()) {
            match op_index.get(op) {
                Some(&i) => ops[i].1.push(m.id.clone()),
                None => {
                    op_index.insert(op, ops.len());
                    ops.push((op.to_string(), vec![m.id.clone()]));
                }
            }
        }
    }
    for (op, ids) in &ops {
        if ids.len() > 1 {
            let mut sorted = ids.clone();
            sorted.sort();
            add(3, "critical", op.clone(), "1".into(), ids.len().to_string(), format!("operation filed more than once: {}", sorted.join(",")));
        }
    }
    // 5./6.
    let mut transit_net = Ordered::default();
    for m in &live {
        let Some(tid) = m.transfer_id.as_deref().filter(|x| !x.is_empty()) else { continue };
        let k = format!("{}/{}", tid, m.product_id);
        if m.to_location_id.as_deref() == Some(TRANSIT) {
            transit_net.add(k.clone(), m.qty);
        }
        if m.from_location_id.as_deref() == Some(TRANSIT) {
            transit_net.add(k.clone(), -m.qty);
        }
    }
    let transfers: HashMap<&str, &Transfer> = s.transfers.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut open_by_product = Ordered::default();
    for k in &transit_net.keys {
        let net = transit_net.get(k);
        let cut = k.find('/').unwrap_or(k.len());
        let (tid, pid) = (&k[..cut], &k[(cut + 1).min(k.len())..]);
        let t = transfers.get(tid);
        if net < -EPS {
            add(4, "critical", k.clone(), ">=0".into(), num(net), "more left transit than entered it".into());
        } else if t.map_or(false, |t| CLOSED_TRANSFER.contains(&t.status.as_str())) && net.abs() > EPS {
            add(4, "critical", k.clone(), "0".into(), num(net), "closed transfer still holds goods in transit".into());
        }
        if t.map_or(false, |t| OPEN_TRANSFER.contains(&t.status.as_str())) {
            open_by_product.add(pid.to_string(), net);
        }
    }
    let mut transit_products: Vec<String> = open_by_product.keys.clone();
    let mut listed: HashSet<String> = transit_products.iter().cloned().collect();
    let prefix = format!("{}__", TRANSIT);
    for id in &ledger.keys {
        if let Some(pid) = id.strip_prefix(&prefix) {
            if listed.insert(pid.to_string()) {
                transit_products.push(pid.to_string());
            }
        }
    }
    for pid in &transit_products {
        let a = open_by_product.get(pid);
        let b = ledger.get(&key(TRANSIT, pid));
        if (a - b).abs() > EPS {
            add(5, "critical", key(TRANSIT, pid), num(a), num(b), "transit balance differs from open transfers".into());
        }
    }
    // 7.
    for p in &s.products {
        for c in &p.unit_conversions {
            let ent = format!("{}/{}", p.id, c.label);
            let size_ok = c.size.is_finite() && c.size > 0.0;
            let per_ok = c.per.map_or(true, |x| x.is_finite() && x > 0.0);
            if !size_ok || !per_ok {
                let per = c.per.map_or("1".to_string(), num);
                add(6, "critical", ent, ">0".into(), format!("{}/{}", num(c.size), per), "conversion rate is not a positive number".into());
            } else if resolve_factor(p, &c.label, 0).is_none() {
                add(6, "warning", ent, p.unit_type.clone(), c.of.clone().unwrap_or_default(), "conversion does not resolve to the product unit".into());
            }
        }
    }
    // 8.
    let products: HashSet<&str> = s.products.iter().map(|p| p.id.as_str()).collect();
    let locations: HashSet<&str> = s.locations.iter().map(|l| l.id.as_str()).collect();
    for m in &s.movements {
        if !products.contains(m.product_id.as_str()) {
            add(7, "warning", m.id.clone(), "product".into(), m.product_id.clone(), "movement names a missing product".into());
        }
        for loc in [&m.from_location_id, &m.to_location_id].into_iter().flatten() {
            if !loc.is_empty() && loc != TRANSIT && !locations.contains(loc.as_str()) {
                add(7, "warning", m.id.clone(), "location".into(), loc.clone(), "movement names a missing location".into());
            }
        }
    }
    // 9.
    for l in &s.levels {
        let r = l.reserved.unwrap_or(0.0);
        if r < -EPS || r - l.qty > EPS {
            add(8, "critical", l.id.clone(), format!("0..{}", num(l.qty)), num(r), "reserved is outside 0..on hand".into());
        }
    }
    // 10.
    let mut posted: HashMap<String, f64> = HashMap::new();
    for c in &s.closed_periods {
        posted.insert(format!("{}__{}", c.location_id, c.month), c.posted_at);
    }
    for m in &live {
        if m.lock_override.as_deref().map_or(false, |r| !r.trim().is_empty()) {
            continue;
        }
        let month = bkk_month(m.date);
        for loc in [&m.from_location_id, &m.to_location_id].into_iter().flatten() {
            if loc.is_empty() || loc == TRANSIT {
                continue;
            }
            if let Some(&at) = posted.get(&format!("{}__{}", loc, month)) {
                if m.created_at > at {
                    add(9, "critical", format!("{}@{}", m.id, loc), format!("<={}", js_string(at)), js_string(m.created_at), format!("filed into {} after its count was posted", month));
                }
            }
        }
    }

    let mut findings = Vec::new();
    for mut g in groups {
        g.sort_by(|a, b| a.entity.cmp(&b.entity)); // stable, as Array.prototype.sort is
        findings.extend(g);
    }
    let status = if findings.iter().any(|f| f.severity == "critical") {
        "FAIL"
    } else if !findings.is_empty() {
        "WARNING"
    } else {
        "PASS"
    };
    Report { schema: SCHEMA.into(), status: status.into(), findings }
}

/// Parse a snapshot and check it. The only fallible step is the JSON itself.
pub fn check_json(input: &str) -> Result<Report, String> {
    let s: Snapshot = serde_json::from_str(input).map_err(|e| e.to_string())?;
    if s.schema != SCHEMA {
        return Err(format!("schema {} is not {}", s.schema, SCHEMA));
    }
    Ok(check(&s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_like_javascript() {
        assert_eq!(round3(-0.0004), 0.0);
        assert_eq!(js_string(round3(-0.0004)), "0");
        assert_eq!(round3(2.5e-3), 0.003);
        assert_eq!(round3(-2.5e-3), -0.002); // Math.round(-2.5) is -2
        assert_eq!(num(0.1 + 0.2), "0.3");
        assert_eq!(js_string(1_790_823_600_000.0), "1790823600000");
    }

    #[test]
    fn bangkok_month() {
        assert_eq!(bkk_month(1_790_789_400_000.0), "2026-10"); // 2026-09-30T17:30Z
        assert_eq!(bkk_month(1_790_787_540_000.0), "2026-09"); // 2026-09-30T16:59Z
    }
}
