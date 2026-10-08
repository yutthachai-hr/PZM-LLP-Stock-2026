// R&D (Goose evaluation, 8 Oct 2026). NOT on any app path; never reads or writes a database.
//
// A third implementation of `pzm-integrity/1` — the ten invariants of
// src/agent/integrityReference.ts (the reference) and crates/pzm-integrity (Rust) — over the
// flat contract `pzm-integrity-flat/1` (research/goose/flat.ts). It must give the reference's
// report exactly: same findings, same order, same strings. Every rule below names the
// reference line it mirrors; nothing here is a new accounting rule.
//
//   integrity --batch < snapshots.flat      one JSON report per snapshot, one per line
//   integrity --bench N < one.flat          the check N times; timings (ms) on stderr
//
// Numbers arrive as IEEE-754 bits (bits.h), so no decimal parsing can differ from JavaScript's.

import std;
import dictionary;
import os;

extern "pzm_f64_from_bits" fn f64_from_bits(b: u64) -> f64;
extern "pzm_floor" fn c_floor(x: f64) -> f64;
extern "pzm_is_finite" fn is_finite(x: f64) -> bool;

let EPS = 0.0005;
let BKK_OFFSET_MS: i64 = 25200000;
let DAY_MS: i64 = 86400000;
let NONE: i32 = -1;

// ---------------------------------------------------------------- numbers, as JS ----

// Math.round(n * 1000) / 1000, half up as JavaScript rounds; no negative zero.
fn round3(n: f64) -> f64 {
    let x = n * 1000.0;
    var r = x;
    if is_finite(x) {
        let f = c_floor(x);
        r = if x - f >= 0.5 { f + 1.0 } else { f };
    }
    let out = r / 1000.0;
    if out == 0.0 { 0.0 } else { out }
}

fn absf(x: f64) -> f64 { if x < 0.0 { 0.0 - x } else { x } }

// String(round3(n)) for the range PZM uses. A value this contract cannot print exactly as
// JavaScript would (|x| >= 1e12) sets `bad` instead of guessing.
fn put_num(out: u8[>..]&, n: f64, bad: bool&) {
    let r = round3(n);
    if r != r { out.append("NaN"); return; }
    if !is_finite(r) { if r > 0.0 { out.append("Infinity"); } else { out.append("-Infinity"); } return; }
    if absf(r) >= 1000000000000.0 { bad = true; return; }
    var k = (c_floor(absf(r) * 1000.0 + 0.5)) as i64;
    if r < 0.0 { out.append("-"); }
    format_int(out, k / 1000, 10, 0, ' ');
    var frac = k % 1000;
    if frac != 0 {
        out.append(".");
        var digits = 3;
        while frac % 10 == 0 { frac = frac / 10; digits--; }
        format_int(out, frac, 10, digits, '0');
    }
}

// String(n) for an integral number of milliseconds or a count.
fn put_int(out: u8[>..]&, n: f64, bad: bool&) {
    if n != n || !is_finite(n) || c_floor(n) != n || absf(n) > 9007199254740991.0 { bad = true; return; }
    format_int(out, n as i64, 10, 0, ' ');
}

// 'YYYY-MM' of the Bangkok day containing `ms` (Howard Hinnant's civil_from_days, as Rust).
fn put_bkk_month(out: u8[>..]&, ms: f64) {
    let t = (ms as i64) + BKK_OFFSET_MS;
    var days = t / DAY_MS;
    if t % DAY_MS != 0 && t < 0 { days -= 1; }   // floor division (Goose % is Euclidean, / truncates)
    let z = days + 719468;
    var era = z / 146097;
    if z < 0 && z % 146097 != 0 { era -= 1; }
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format_int(out, year, 10, 4, '0');
    out.append("-");
    format_int(out, m, 10, 2, '0');
}

// ---------------------------------------------------------------- strings ----

// Interned text: every distinct string once in `arena`, named by its index.
struct Strings { arena: u8[>..] }

fn hexval(c: u8) -> u64 {
    if c >= '0' && c <= '9' { (c - '0') as u64 } else { (c - 'a' + 10) as u64 }
}
fn parse_bits(s: u8[:], ok: bool&) -> f64 {
    if s.len != 16 { ok = false; return 0.0; }
    var b: u64 = 0;
    for c in s {
        if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) { ok = false; return 0.0; }
        b = (b << 4) | hexval(c);
    }
    return f64_from_bits(b);
}

// Undo flat.ts's escaping into `out`.
fn unescape(out: u8[>..]&, s: u8[:]) {
    var i = 0;
    while i < s.len {
        let c = s[i];
        if c == 92 && i + 1 < s.len {
            let d = s[i + 1];
            if d == 't' { out.push(9); } else if d == 'n' { out.push(10); } else if d == 'r' { out.push(13); } else { out.push(d); }
            i += 2;
        } else { out.push(c); i++; }
    }
}

fn is_ws(c: u8) -> bool { c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == 11 || c == 12 }

// unit_key: trim + lowercase. ASCII only — a known limit of this prototype (JS and Rust lower
// every cased letter); flat.ts's caller reports unit labels outside ASCII + Thai.
fn unit_key(out: u8[>..]&, s: u8[:]) {
    var a = 0;
    var b = s.len;
    while a < b && is_ws(s[a]) { a++; }
    while b > a && is_ws(s[b - 1]) { b--; }
    for c in s[a..b] { out.push(if c >= 'A' && c <= 'Z' { c + 32 } else { c }); }
}

// Compare `s` (trimmed, ASCII-lowercased) with a key already in that form.
fn key_eq(s: u8[:], k: u8[:]) -> bool {
    var a = 0;
    var b = s.len;
    while a < b && is_ws(s[a]) { a++; }
    while b > a && is_ws(s[b - 1]) { b--; }
    if b - a != k.len { return false; }
    for i in k.len {
        let c = s[a + i];
        let l = if c >= 'A' && c <= 'Z' { c + 32 } else { c };
        if l != k[i] { return false; }
    }
    return true;
}

fn same_unit(a: u8[:], b: u8[:]) -> bool {
    var x: u8[>..] = [];
    var y: u8[>..] = [];
    unit_key(x, a);
    unit_key(y, b);
    return compare(x, y) == 0;
}

// measure_of: 0 = mass, 1 = volume, -1 = neither; and the size in kg / l.
fn measure_of(u: u8[:]) -> i64, f64 {
    if key_eq(u, "g") || key_eq(u, "กรัม") || key_eq(u, "gram") || key_eq(u, "grams") { return 0, 0.001; }
    if key_eq(u, "kg") || key_eq(u, "กก.") || key_eq(u, "กก") || key_eq(u, "กิโลกรัม") || key_eq(u, "kilogram") || key_eq(u, "kilograms") { return 0, 1.0; }
    if key_eq(u, "ml") || key_eq(u, "มล.") || key_eq(u, "มล") || key_eq(u, "มิลลิลิตร") || key_eq(u, "millilitre") || key_eq(u, "milliliter") { return 1, 0.001; }
    if key_eq(u, "l") || key_eq(u, "lt") || key_eq(u, "ลิตร") || key_eq(u, "litre") || key_eq(u, "liter") || key_eq(u, "litres") || key_eq(u, "liters") { return 1, 1.0; }
    return -1, 0.0;
}

fn standard_resolves(from: u8[:], to: u8[:]) -> bool {
    if same_unit(from, to) { return true; }
    let ma, sa = measure_of(from);
    let mb, sb = measure_of(to);
    return ma >= 0 && ma == mb;
}

// ---------------------------------------------------------------- the snapshot ----
// Every string is a slice into one grow-only arena (references into it survive growth);
// absent optional strings are flagged, so "" and absent stay different, as in the reference.

struct Product  { id: u8[:], unit: u8[:], c0: i64, c1: i64 }
struct Conv     { label: u8[:], size: f64, has_per: bool, per: f64, has_of: bool, of: u8[:] }
struct Level    { id: u8[:], qty: f64, has_res: bool, reserved: f64 }
struct Move     { id: u8[:], product: u8[:], qty: f64, has_from: bool, from: u8[:], has_to: bool, to: u8[:],
                  date: f64, created: f64, voided: bool, has_op: bool, op: u8[:], has_po: bool, po: u8[:],
                  has_tr: bool, tr: u8[:], locked_open: bool }
struct Order    { id: u8[:], status: u8[:], loc: u8[:], l0: i64, l1: i64 }
struct Line     { product: u8[:], received: f64 }
struct Transfer { id: u8[:], status: u8[:] }
struct Closed   { loc: u8[:], month: u8[:], posted: f64 }
struct Finding  { rule: i64, critical: bool, entity: const u8[:], expected: const u8[:], actual: const u8[:], reason: const u8[:] }

let RULES = ["INV.LEVEL_EQ_LEDGER", "INV.NO_NEGATIVE_LEDGER", "INV.PO_RECEIVED_EQ_RECEIPTS", "INV.NO_DUPLICATE_RECEIPT_OP",
             "INV.TRANSFER_CONSERVATION", "INV.TRANSIT_EQ_OPEN_TRANSFERS", "INV.UNIT_CONVERSION_VALID", "INV.NO_ORPHAN_LEDGER",
             "INV.AVAILABLE_LE_ONHAND", "INV.PERIOD_LOCK_CONSISTENT"];

fn truthy(has: bool, s: u8[:]) -> bool { has && s.len > 0 }

fn is_open(s: u8[:]) -> bool { compare(s, "inTransit") == 0 || compare(s, "receiving") == 0 || compare(s, "discrepancy") == 0 || compare(s, "pendingDiscrepancyApproval") == 0 }
fn is_closed(s: u8[:]) -> bool { compare(s, "completed") == 0 || compare(s, "resolved") == 0 || compare(s, "cancelled") == 0 || compare(s, "rejected") == 0 }

// resolveFactor(p, label) !== null (only whether it resolves is used by the invariant).
recursive fn resolves(convs: Conv[:], p: Product, entry: u8[:], depth: i64) -> bool {
    if entry.len == 0 || same_unit(entry, p.unit) { return true; }
    if depth > 6 { return false; }
    for c in convs[p.c0..p.c1] {
        guard same_unit(c.label, entry) else { continue; }
        // the first conversion with that label decides, as `find` does
        if is_finite(c.size) && c.size > 0.0 && (!c.has_per || c.per > 0.0) {
            if !c.has_of || c.of.len == 0 || same_unit(c.of, p.unit) { return true; }
            if same_unit(c.of, entry) { return false; }
            return resolves(convs, p, c.of, depth + 1);
        }
        return standard_resolves(entry, p.unit);
    }
    return standard_resolves(entry, p.unit);
}

// ---------------------------------------------------------------- report text ----

fn put_json_str(out: u8[>..]&, s: u8[:]) {
    out.push('"');
    for c in s {
        if c == '"' { out.append("\\\""); }
        else if c == 92 { out.append("\\\\"); }
        else if c < 32 { out.push(92); out.append("u00"); format_int(out, c as i64, 16, 2, '0'); }
        else { out.push(c); }
    }
    out.push('"');
}

// ---------------------------------------------------------------- one snapshot ----

// The lines of one snapshot (between S and E) → its report, one JSON line, onto `out`.
// Returns false on input outside the contract (the caller prints an error line instead).
fn check(lines: const u8[:][:], out: u8[>..]&) -> bool {
    var arena: u8[>..] = [];
    var products: Product[>..] = [];
    var convs: Conv[>..] = [];
    var locations: u8[:][>..] = [];
    var levels: Level[>..] = [];
    var moves: Move[>..] = [];
    var orders: Order[>..] = [];
    var olines: Line[>..] = [];
    var transfers: Transfer[>..] = [];
    var closed: Closed[>..] = [];
    var ok = true;
    var bad = false;

    // ---- read
    for line in lines {
        let f = split(line, '\t');
        guard f.len > 0;
        let t = f[0];
        // a field as text in the arena (unescaped); `=`-prefixed optionals first lose the `=`
        // (the slices below are taken after all pushes of a record, so they stay put)
        if compare(t, "P") == 0 && f.len == 3 {
            let a = arena.len; unescape(arena, f[1]); let b = arena.len; unescape(arena, f[2]); let c = arena.len;
            products.push(Product { id: arena[a..b], unit: arena[b..c], c0: convs.len, c1: convs.len });
        } else if compare(t, "C") == 0 && f.len == 5 && products.len > 0 {
            let a = arena.len; unescape(arena, f[1]); let b = arena.len;
            let has_of = f[4].len > 0;
            if has_of { unescape(arena, f[4][1..]); }
            let c = arena.len;
            let size = parse_bits(f[2], ok);
            let has_per = f[3].len > 0;
            let per = if has_per { parse_bits(f[3][1..], ok) } else { 0.0 };
            convs.push(Conv { label: arena[a..b], size: size, has_per: has_per, per: per, has_of: has_of, of: arena[b..c] });
            last(products).c1 = convs.len;
        } else if compare(t, "L") == 0 && f.len == 2 {
            let a = arena.len; unescape(arena, f[1]);
            locations.push(arena[a..]);
        } else if compare(t, "V") == 0 && f.len == 4 {
            let a = arena.len; unescape(arena, f[1]);
            let has_res = f[3].len > 0;
            levels.push(Level { id: arena[a..], qty: parse_bits(f[2], ok), has_res: has_res, reserved: if has_res { parse_bits(f[3][1..], ok) } else { 0.0 } });
        } else if compare(t, "M") == 0 && f.len == 13 {
            var at: i64[8];
            at[0] = arena.len; unescape(arena, f[1]);
            at[1] = arena.len; unescape(arena, f[2]);
            at[2] = arena.len; if f[4].len > 0 { unescape(arena, f[4][1..]); }
            at[3] = arena.len; if f[5].len > 0 { unescape(arena, f[5][1..]); }
            at[4] = arena.len; if f[9].len > 0 { unescape(arena, f[9][1..]); }
            at[5] = arena.len; if f[10].len > 0 { unescape(arena, f[10][1..]); }
            at[6] = arena.len; if f[11].len > 0 { unescape(arena, f[11][1..]); }
            at[7] = arena.len;
            // lockOverride only matters as "non-empty after trim" (reference line 186)
            var lock: u8[>..] = [];
            if f[12].len > 0 { unescape(lock, f[12][1..]); }
            var la = 0; var lb = lock.len;
            while la < lb && is_ws(lock[la]) { la++; }
            while lb > la && is_ws(lock[lb - 1]) { lb--; }
            moves.push(Move { id: arena[at[0]..at[1]], product: arena[at[1]..at[2]], qty: parse_bits(f[3], ok),
                has_from: f[4].len > 0, from: arena[at[2]..at[3]], has_to: f[5].len > 0, to: arena[at[3]..at[4]],
                date: parse_bits(f[6], ok), created: parse_bits(f[7], ok), voided: compare(f[8], "1") == 0,
                has_op: f[9].len > 0, op: arena[at[4]..at[5]], has_po: f[10].len > 0, po: arena[at[5]..at[6]],
                has_tr: f[11].len > 0, tr: arena[at[6]..at[7]], locked_open: lb > la });
        } else if compare(t, "O") == 0 && f.len == 4 {
            let a = arena.len; unescape(arena, f[1]); let b = arena.len; unescape(arena, f[2]); let c = arena.len; unescape(arena, f[3]);
            orders.push(Order { id: arena[a..b], status: arena[b..c], loc: arena[c..], l0: olines.len, l1: olines.len });
        } else if compare(t, "I") == 0 && f.len == 3 && orders.len > 0 {
            let a = arena.len; unescape(arena, f[1]);
            olines.push(Line { product: arena[a..], received: parse_bits(f[2], ok) });
            last(orders).l1 = olines.len;
        } else if compare(t, "T") == 0 && f.len == 5 {
            let a = arena.len; unescape(arena, f[1]); let b = arena.len; unescape(arena, f[2]);
            transfers.push(Transfer { id: arena[a..b], status: arena[b..] });
        } else if compare(t, "K") == 0 && f.len == 4 {
            let a = arena.len; unescape(arena, f[1]); let b = arena.len; unescape(arena, f[2]);
            closed.push(Closed { loc: arena[a..b], month: arena[b..], posted: parse_bits(f[3], ok) });
        } else {
            return false;
        }
    }
    guard ok else { return false; }

    var findings: Finding[>..] = [];

    // ---- the ledger (reference 108-113): `${loc}__${pid}`, summed in movement order
    var ledger = dictionary<u8[:], f64> {};
    var ledger_keys: u8[:][>..] = [];
    for m in moves {
        guard !m.voided;
        if truthy(m.has_from, m.from) {
            let a = arena.len; arena.append(m.from); arena.append("__"); arena.append(m.product);
            let k = arena[a..];
            if !ledger.contains(k) { ledger.insert(k, 0.0); ledger_keys.push(k); }
            ledger.update(k, 0.0) { it = round3(it - m.qty); };
        }
        if truthy(m.has_to, m.to) {
            let a = arena.len; arena.append(m.to); arena.append("__"); arena.append(m.product);
            let k = arena[a..];
            if !ledger.contains(k) { ledger.insert(k, 0.0); ledger_keys.push(k); }
            ledger.update(k, 0.0) { it = round3(it + m.qty); };
        }
    }

    // 1. stored balance = ledger (115-121); a duplicated level id: the last one wins (a Map)
    var stored = dictionary<u8[:], f64> {};
    var stored_keys: u8[:][>..] = [];
    for l in levels {
        if !stored.contains(l.id) { stored_keys.push(l.id); }
        stored.insert(l.id, l.qty);
    }
    var union_seen = dictionary<u8[:], bool> {};
    var union: u8[:][>..] = [];
    for k in ledger_keys { if !union_seen.contains(k) { union_seen.insert(k, true); union.push(k); } }
    for k in stored_keys { if !union_seen.contains(k) { union_seen.insert(k, true); union.push(k); } }
    for id in union {
        let la = ledger.get(id);
        let a = if la { la } else { 0.0 };
        let sb = stored.get(id);
        let b = if sb { sb } else { 0.0 };
        if absf(a - b) > EPS {
            let x = arena.len; put_num(arena, a, bad); let y = arena.len; put_num(arena, b, bad);
            findings.push(Finding { rule: 0, critical: true, entity: id, expected: arena[x..y], actual: arena[y..], reason: "stored balance differs from the ledger" });
        }
    }
    // 2. nothing below zero (123)
    for id in ledger_keys {
        let la = ledger.get(id);
        guard la;
        let a: f64 = la;
        if a < 0.0 - EPS {
            let x = arena.len; put_num(arena, a, bad);
            findings.push(Finding { rule: 1, critical: true, entity: id, expected: "0", actual: arena[x..], reason: "ledger balance below zero" });
        }
    }

    // 3. order line received = its receipts (125-132). The reference sums, per line, every live
    //    movement of that order and product with a destination, in movement order; grouped
    //    here in one pass — the same additions in the same order.
    var po_sum = dictionary<u8[:], f64> {};
    for m in moves {
        guard !m.voided && m.has_po && truthy(m.has_to, m.to);
        let a = arena.len; format_int(arena, m.po.len, 10, 0, ' '); arena.push(58); arena.append(m.po); arena.append(m.product);
        let k = arena[a..];
        po_sum.update(k, 0.0) { it = round3(it + m.qty); };
    }
    for o in orders {
        for l in olines[o.l0..o.l1] {
            let a = arena.len; format_int(arena, o.id.len, 10, 0, ' '); arena.push(58); arena.append(o.id); arena.append(l.product);
            let got = po_sum.get(arena[a..]);
            let sum = if got { got } else { 0.0 };
            if absf(sum - l.received) > EPS {
                let e = arena.len; arena.append(o.id); arena.append("/"); arena.append(l.product);
                let x = arena.len; put_num(arena, sum, bad); let y = arena.len; put_num(arena, l.received, bad);
                findings.push(Finding { rule: 2, critical: true, entity: arena[e..x], expected: arena[x..y], actual: arena[y..], reason: "order line received differs from its receipts" });
            }
        }
    }

    // 4. one operation, one movement (134-136)
    var ops = dictionary<u8[:], i64> {};
    var op_keys: u8[:][>..] = [];
    for m in moves {
        guard !m.voided && truthy(m.has_op, m.op);
        if !ops.contains(m.op) { op_keys.push(m.op); }
        ops.update(m.op, 0) { it += 1; };
    }
    for op in op_keys {
        let gn = ops.get(op);
        guard gn;
        let n: i64 = gn;
        guard n > 1;
        var ids: u8[:][>..] = [];
        for m in moves { if !m.voided && truthy(m.has_op, m.op) && compare(m.op, op) == 0 { ids.push(m.id); } }
        sort(ids) { a, b => compare(a, b) < 0 };   // equal ids are equal text: their order cannot show
        let x = arena.len; format_int(arena, n, 10, 0, ' ');
        let y = arena.len; arena.append("operation filed more than once: ");
        for id, i in ids { if i > 0 { arena.append(","); } arena.append(id); }
        findings.push(Finding { rule: 3, critical: true, entity: op, expected: "1", actual: arena[x..y], reason: arena[y..] });
    }

    // 5./6. transit per transfer and product (139-161), keys in first-seen order
    var net = dictionary<u8[:], f64> {};
    var net_keys: u8[:][>..] = [];
    for m in moves {
        guard !m.voided && truthy(m.has_tr, m.tr);
        let a = arena.len; arena.append(m.tr); arena.append("/"); arena.append(m.product);
        let k = arena[a..];
        let to_transit = m.has_to && compare(m.to, "transit") == 0;
        let from_transit = m.has_from && compare(m.from, "transit") == 0;
        if (to_transit || from_transit) && !net.contains(k) { net.insert(k, 0.0); net_keys.push(k); }
        if to_transit { net.update(k, 0.0) { it = round3(it + m.qty); }; }
        if from_transit { net.update(k, 0.0) { it = round3(it - m.qty); }; }
    }
    var tstatus = dictionary<u8[:], u8[:]> {};
    for t in transfers { tstatus.insert(t.id, t.status); }
    var open_by = dictionary<u8[:], f64> {};
    var open_keys: u8[:][>..] = [];
    for k in net_keys {
        var cut = 0;
        while k[cut] != '/' { cut++; }
        let tid = k[..cut];
        let pid = k[cut + 1..];
        let gv = net.get(k);
        guard gv;
        let v: f64 = gv;
        let gst = tstatus.get(tid);
        let has_st = if gst { true } else { false };
        var st: u8[:] = k[0..0];
        if gst { st = gst; }
        if v < 0.0 - EPS {
            let x = arena.len; put_num(arena, v, bad);
            findings.push(Finding { rule: 4, critical: true, entity: k, expected: ">=0", actual: arena[x..], reason: "more left transit than entered it" });
        } else if has_st && is_closed(st) && absf(v) > EPS {
            let x = arena.len; put_num(arena, v, bad);
            findings.push(Finding { rule: 4, critical: true, entity: k, expected: "0", actual: arena[x..], reason: "closed transfer still holds goods in transit" });
        }
        if has_st && is_open(st) {
            if !open_by.contains(pid) { open_by.insert(pid, 0.0); open_keys.push(pid); }
            open_by.update(pid, 0.0) { it = round3(it + v); };
        }
    }
    var tp_seen = dictionary<u8[:], bool> {};
    var tps: u8[:][>..] = [];
    for p in open_keys { if !tp_seen.contains(p) { tp_seen.insert(p, true); tps.push(p); } }
    for id in ledger_keys {
        if starts_with(id, "transit__") {
            let p = id[9..];
            if !tp_seen.contains(p) { tp_seen.insert(p, true); tps.push(p); }
        }
    }
    for pid in tps {
        let oa = open_by.get(pid);
        let a = if oa { oa } else { 0.0 };
        let e = arena.len; arena.append("transit__"); arena.append(pid);
        let lb = ledger.get(arena[e..]);
        let b = if lb { lb } else { 0.0 };
        if absf(a - b) > EPS {
            let x = arena.len; put_num(arena, a, bad); let y = arena.len; put_num(arena, b, bad);
            findings.push(Finding { rule: 5, critical: true, entity: arena[e..x], expected: arena[x..y], actual: arena[y..], reason: "transit balance differs from open transfers" });
        }
    }

    // 7. unit rates (164-170)
    for p in products {
        for c in convs[p.c0..p.c1] {
            let e = arena.len; arena.append(p.id); arena.append("/"); arena.append(c.label);
            let ent = arena[e..];
            let size_ok = is_finite(c.size) && c.size > 0.0;
            let per_ok = !c.has_per || (is_finite(c.per) && c.per > 0.0);
            if !size_ok || !per_ok {
                let x = arena.len; put_num(arena, c.size, bad); arena.append("/");
                if c.has_per { put_num(arena, c.per, bad); } else { arena.append("1"); }
                findings.push(Finding { rule: 6, critical: true, entity: ent, expected: ">0", actual: arena[x..], reason: "conversion rate is not a positive number" });
            } else if !resolves(convs, p, c.label, 0) {
                let x = arena.len; arena.append(c.of);
                findings.push(Finding { rule: 6, critical: false, entity: ent, expected: p.unit, actual: arena[x..], reason: "conversion does not resolve to the product unit" });
            }
        }
    }
    // 8. no orphans (172-177) — every movement, voided ones too
    var pset = dictionary<u8[:], bool> {};
    for p in products { pset.insert(p.id, true); }
    var lset = dictionary<u8[:], bool> {};
    for l in locations { lset.insert(l, true); }
    for m in moves {
        if !pset.contains(m.product) {
            findings.push(Finding { rule: 7, critical: false, entity: m.id, expected: "product", actual: m.product, reason: "movement names a missing product" });
        }
        if truthy(m.has_from, m.from) && compare(m.from, "transit") != 0 && !lset.contains(m.from) {
            findings.push(Finding { rule: 7, critical: false, entity: m.id, expected: "location", actual: m.from, reason: "movement names a missing location" });
        }
        if truthy(m.has_to, m.to) && compare(m.to, "transit") != 0 && !lset.contains(m.to) {
            findings.push(Finding { rule: 7, critical: false, entity: m.id, expected: "location", actual: m.to, reason: "movement names a missing location" });
        }
    }
    // 9. reserved within 0..on hand (179-182)
    for l in levels {
        let r = if l.has_res { l.reserved } else { 0.0 };
        if r < 0.0 - EPS || r - l.qty > EPS {
            let x = arena.len; arena.append("0.."); put_num(arena, l.qty, bad); let y = arena.len; put_num(arena, r, bad);
            findings.push(Finding { rule: 8, critical: true, entity: l.id, expected: arena[x..y], actual: arena[y..], reason: "reserved is outside 0..on hand" });
        }
    }
    // 10. closed months (184-193); a repeated location+month: the last one wins (a Map)
    var posted = dictionary<u8[:], f64> {};
    for c in closed {
        let a = arena.len; arena.append(c.loc); arena.append("__"); arena.append(c.month);
        posted.insert(arena[a..], c.posted);
    }
    for m in moves {
        guard !m.voided && !m.locked_open;
        let ma = arena.len; put_bkk_month(arena, m.date); let month = arena[ma..];
        for side in 2 {
            let has = if side == 0 { truthy(m.has_from, m.from) } else { truthy(m.has_to, m.to) };
            guard has;
            let loc = if side == 0 { m.from } else { m.to };
            guard compare(loc, "transit") != 0;
            let k = arena.len; arena.append(loc); arena.append("__"); arena.append(month);
            let gat = posted.get(arena[k..]);
            guard gat;
            let at: f64 = gat;
            if m.created > at {
                let e = arena.len; arena.append(m.id); arena.append("@"); arena.append(loc);
                let x = arena.len; arena.append("<="); put_int(arena, at, bad);
                let y = arena.len; put_int(arena, m.created, bad);
                let z = arena.len; arena.append("filed into "); arena.append(month); arena.append(" after its count was posted");
                findings.push(Finding { rule: 9, critical: true, entity: arena[e..x], expected: arena[x..y], actual: arena[y..z], reason: arena[z..] });
            }
        }
    }
    guard !bad else { return false; }

    // ---- the report: invariant order, then entity (stable, as Array.prototype.sort)
    // Sorted by index, the original position breaking ties: a stable order, as the reference's
    // Array.prototype.sort, without moving the slices (Goose will not copy references that way).
    var order: i64[>..] = [];
    for i in findings.len { order.push(i); }
    sort(order) { a, b => block {
        let fa = findings[a];
        let fb = findings[b];
        if fa.rule != fb.rule { break fa.rule < fb.rule; }
        let c = compare(fa.entity, fb.entity);
        if c != 0 { break c < 0; }
        a < b
    } };
    var any_critical = false;
    for f in findings { if f.critical { any_critical = true; } }
    out.append("{\"schema\":\"pzm-integrity/1\",\"status\":\"");
    out.append(if any_critical { "FAIL" } else if findings.len > 0 { "WARNING" } else { "PASS" });
    out.append("\",\"findings\":[");
    for k, i in order {
        let f = findings[k];
        if i > 0 { out.push(','); }
        out.append("{\"ruleId\":\""); out.append(RULES[f.rule]);
        out.append("\",\"severity\":\""); out.append(if f.critical { "critical" } else { "warning" });
        out.append("\",\"entity\":"); put_json_str(out, f.entity);
        out.append(",\"expected\":"); put_json_str(out, f.expected);
        out.append(",\"actual\":"); put_json_str(out, f.actual);
        out.append(",\"reason\":"); put_json_str(out, f.reason);
        out.push('}');
    }
    out.append("]}\n");
    return true;
}

// ---------------------------------------------------------------- main ----

fn main() {
    var input: u8[>..] = [];
    read_stdin(input);
    let lines = split(input, '\n');
    var bench = 0;
    if arg_count() > 2 {
        var a: u8[>..] = [];
        arg(1, a);
        if compare(a, "--bench") == 0 {
            var n: u8[>..] = [];
            arg(2, n);
            let v, okn = parse_int(n);
            if okn { bench = v; }
        }
    }
    var out: u8[>..] = [];
    var start = -1;
    for line, i in lines {
        var l = line;
        if l.len > 0 && l[l.len - 1] == '\r' { l = l[..l.len - 1]; }
        if compare(l, "S") == 0 { start = i + 1; continue; }
        guard compare(l, "E") == 0 && start >= 0;
        let body = lines[start..i];
        if bench > 0 {
            var times: f64[>..] = [];
            for r in bench {
                var scratch: u8[>..] = [];
                let t0 = clock();
                check(body, scratch);
                times.push((clock() - t0) * 1000.0);
            }
            sort(times);
            var msg: u8[>..] = [];
            msg.append("{\"runs\":"); format_int(msg, bench, 10, 0, ' ');
            msg.append(",\"p50_ms\":"); format_flt(msg, times[times.len / 2], 3);
            msg.append(",\"p95_ms\":"); format_flt(msg, times[min(times.len - 1, (times.len * 95) / 100)], 3);
            msg.append("}\n");
            write_stderr(msg);
        }
        if !check(body, out) { out.append("{\"error\":\"input outside pzm-integrity-flat/1\"}\n"); }
        start = -1;
    }
    write_stdout(out);
}
