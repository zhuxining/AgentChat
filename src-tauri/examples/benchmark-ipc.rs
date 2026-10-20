//! Synthetic IPC benchmark: uses production transport modules with fake credentials/runtime.
//! The caller supplies a temporary fixture and the bundled benchmark Node entry.
#![allow(dead_code)]

#[path = "../src/host.rs"]
mod host;
#[path = "../src/runner/mod.rs"]
mod runner;

mod runtime {
    pub fn require_ready() -> Result<std::path::PathBuf, String> {
        let path = std::env::var_os("BENCH_NODE")
            .map(std::path::PathBuf::from)
            .ok_or("BENCH_NODE is required")?;
        if !path.is_absolute() || !path.is_file() {
            return Err("BENCH_NODE must be an absolute executable path".to_owned());
        }
        Ok(path)
    }
}

mod credentials {
    pub fn native_request(
        _data_dir: &std::path::Path,
        method: &str,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        match method {
            "readCredential" => {
                let delay: u64 = std::env::var("BENCH_CREDENTIAL_DELAY_MS")
                    .map_err(|_| "Benchmark delay is missing")?
                    .parse()
                    .map_err(|_| "Benchmark delay is invalid")?;
                std::thread::sleep(std::time::Duration::from_millis(delay));
                Ok(serde_json::json!({"type": "api_key", "key": "benchmark-synthetic-only"}))
            }
            "env" => Ok(serde_json::Value::Null),
            "fileExists" => Ok(serde_json::Value::Bool(false)),
            _ => Err("Benchmark only supports synthetic credential reads".to_owned()),
        }
    }
}

use host::RunnerConnection;
use runner::RunnerRequest;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Instant;

struct StopHost(RunnerConnection);
impl Drop for StopHost {
    fn drop(&mut self) {
        if let Err(error) = self.0.stop() {
            eprintln!("Benchmark host cleanup failed: {error}");
        }
    }
}

fn measure(name: &str, action: impl Fn() -> Result<Value, String>) -> Result<(), String> {
    for _ in 0..3 {
        action()?;
    }
    let mut timings = Vec::new();
    let mut bytes = 0;
    for _ in 0..30 {
        let start = Instant::now();
        let result = action()?;
        timings.push(start.elapsed().as_secs_f64() * 1000.0);
        bytes = serde_json::to_vec(&result)
            .map_err(|error| error.to_string())?
            .len();
    }
    timings.sort_by(f64::total_cmp);
    println!(
        "{}",
        json!({"name": name, "samples": 30, "p50Ms": timings[14], "p95Ms": timings[28], "resultBytes": bytes})
    );
    Ok(())
}

fn benchmark() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: benchmark-ipc TEMP_DATA_DIR IDS_JSON".to_owned());
    }
    let directory = PathBuf::from(&args[0]);
    if !directory.is_absolute()
        || !directory
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("agentchat-perf-"))
    {
        return Err("Expected the benchmark's absolute temporary fixture directory".to_owned());
    }
    let ids: Vec<u64> =
        serde_json::from_str(&args[1].to_string_lossy()).map_err(|error| error.to_string())?;
    if ids.len() != 20 {
        return Err("Expected 20 fixture conversations".to_owned());
    }
    let connection = RunnerConnection::new(directory.clone(), directory);
    let guard = StopHost(connection);
    guard.0.start()?;
    guard.0.request(RunnerRequest::Initialize)?;
    let delay = std::env::var("BENCH_CREDENTIAL_DELAY_MS").map_err(|error| error.to_string())?;
    measure(&format!("rust-ipc/config-read/auth-{delay}ms"), || {
        guard
            .0
            .request(RunnerRequest::ReadConfiguration {
                path: "runner.json".to_owned(),
            })
            .map(|reply| reply.result)
    })?;
    if delay == "100" {
        let mut timings = Vec::new();
        for _ in 0..33 {
            let connection = guard.0.clone();
            let snapshot_id = ids[2];
            let snapshot = std::thread::spawn(move || {
                connection.request(RunnerRequest::Snapshot {
                    conversation_id: snapshot_id,
                })
            });
            // Allow the host to accept the snapshot and enter its synthetic 100ms native read.
            std::thread::sleep(std::time::Duration::from_millis(20));
            let start = Instant::now();
            let result = guard.0.request(RunnerRequest::ReadConfiguration {
                path: "runner.json".to_owned(),
            });
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            let background = snapshot
                .join()
                .map_err(|_| "Benchmark snapshot worker panicked")?;
            result?;
            background?;
            timings.push(elapsed);
        }
        let mut timings = timings.split_off(3);
        timings.sort_by(f64::total_cmp);
        println!(
            "{}",
            json!({"name": "rust-ipc/config-read-during-100ms-auth", "samples": 30, "p50Ms": timings[14], "p95Ms": timings[28]})
        );
        return Ok(());
    }
    for (name, id) in [("empty", ids[2]), ("1000-entries", ids[0])] {
        measure(&format!("rust-ipc/{name}/auth-{delay}ms"), || {
            guard
                .0
                .request(RunnerRequest::Snapshot {
                    conversation_id: id,
                })
                .map(|reply| reply.result)
        })?;
    }
    measure(&format!("rust-ipc/20-bot-summaries/auth-{delay}ms"), || {
        let requests: Vec<_> = ids
            .iter()
            .map(|&id| {
                let connection = guard.0.clone();
                std::thread::spawn(move || {
                    connection.request(RunnerRequest::Snapshot {
                        conversation_id: id,
                    })
                })
            })
            .collect();
        let mut results = Vec::new();
        let mut failure = None;
        // Join every worker even if one request fails.
        for request in requests {
            match request.join() {
                Ok(Ok(reply)) => results.push(reply.result),
                Ok(Err(error)) => {
                    failure.get_or_insert(error);
                }
                Err(_) => {
                    failure.get_or_insert("Benchmark worker panicked".to_owned());
                }
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }
        Ok(Value::Array(results))
    })?;
    Ok(())
}

fn main() {
    let result = match host::run_if_host() {
        Some(result) => result,
        None => benchmark(),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
