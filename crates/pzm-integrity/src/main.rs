//! `pzm-integrity <snapshot.json | ->` — check a snapshot, print the JSON report.
//!
//! Exit codes: 0 PASS, 1 WARNING, 2 FAIL, 3 unreadable input.
//! `--bench N` runs the check N times on the same input and prints timings to stderr
//! (G13's latency comparison with the TypeScript reference).
//! `--batch` reads one snapshot per stdin line and writes one report per stdout line
//! (G21's differential test against the TypeScript reference); a bad line answers
//! `{"error":…}` and the batch goes on.
use std::io::Read;
use std::time::Instant;

fn batch() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        std::process::exit(3);
    }
    let mut out = String::new();
    for line in input.lines().filter(|l| !l.trim().is_empty()) {
        match pzm_integrity::check_json(line) {
            Ok(r) => out.push_str(&serde_json::to_string(&r).expect("report serialises")),
            Err(e) => out.push_str(&serde_json::json!({ "error": e }).to_string()),
        }
        out.push('\n');
    }
    print!("{}", out);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--batch") {
        batch();
        return;
    }
    let bench = args.iter().position(|a| a == "--bench").and_then(|i| args.get(i + 1)).and_then(|n| n.parse::<usize>().ok());
    let path = args.iter().enumerate().find(|(i, a)| !a.starts_with("--") && (*i == 0 || args[i - 1] != "--bench")).map(|(_, a)| a.clone());
    let input = match path.as_deref() {
        None | Some("-") => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).map(|_| s).map_err(|e| e.to_string())
        }
        Some(p) => std::fs::read_to_string(p).map_err(|e| format!("{}: {}", p, e)),
    };
    let input = match input {
        Ok(s) => s,
        Err(e) => {
            eprintln!("pzm-integrity: {}", e);
            std::process::exit(3);
        }
    };
    let t0 = Instant::now();
    let report = match pzm_integrity::check_json(&input) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("pzm-integrity: {}", e);
            std::process::exit(3);
        }
    };
    let first = t0.elapsed();
    if let Some(n) = bench {
        let snap: pzm_integrity::Snapshot = serde_json::from_str(&input).expect("parsed above");
        let mut times: Vec<f64> = Vec::with_capacity(n);
        for _ in 0..n {
            let t = Instant::now();
            std::hint::black_box(pzm_integrity::check(std::hint::black_box(&snap)));
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p = |q: f64| times[((q * n as f64).ceil() as usize).clamp(1, n) - 1];
        eprintln!("{{\"firstMs\":{:.4},\"runs\":{},\"p50Ms\":{:.4},\"p95Ms\":{:.4}}}", first.as_secs_f64() * 1000.0, n, p(0.5), p(0.95));
    }
    println!("{}", serde_json::to_string(&report).expect("report serialises"));
    std::process::exit(match report.status.as_str() {
        "PASS" => 0,
        "WARNING" => 1,
        _ => 2,
    });
}
