// Package main — Plan-B ClickHouse writer side-car for Bematist.
//
// PLAN_B_SKELETON (Sprint-1 Phase 4, PRD §Phase 4 R2, D-S1-7, D-S1-24)
// ====================================================================
// This binary is the ingest-boundary escape hatch if the Bun + @clickhouse/client
// path flakes the F15 / INT0 24-hour soak. Trip thresholds (PRD §Phase 4 R2):
//
//   1. >= 3 ECONNRESET / idle-socket races per 100k inserts sustained
//   2. p99 insert latency > 500ms for > 10 minutes
//   3. Any silent data-loss signal (CH row-count drift vs WAL xlen)
//
// When tripped, flip `CLICKHOUSE_WRITER=sidecar` in the ingest deployment —
// the Bun ingest then forwards canonical rows over the UNIX socket
// `/tmp/bematist-ingest-sidecar.sock` and this process performs the insert.
// The side-car is part of the ingest BOUNDARY (same deployment unit, same
// tenant+auth context) — contract 02 §Invariants #1 "ingest is the only writer"
// is preserved. See contracts/02-ingest-api.md Changelog (2026-04-16 Phase 4).
//
// Owner: Workstream D (Jorge). No tests today; this is a boot-checkable
// skeleton so ops has something to deploy immediately if the trip threshold
// hits.
//
// TODO(sprint-1 close):
//   - Wire `go-redis/v9` consumer group on `events_wal`
//   - Wire `clickhouse-go/v2` Native protocol writer
//   - Structured log via slog
//   - Prometheus /metrics endpoint
//   - SIGTERM graceful drain
package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
)

const socketPath = "/tmp/bematist-ingest-sidecar.sock"

func main() {
	// Remove any stale socket file.
	_ = os.Remove(socketPath)

	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		log.Fatalf("bematist-ingest-sidecar: failed to listen on %s: %v", socketPath, err)
	}
	defer ln.Close()

	fmt.Printf("bematist-ingest-sidecar PLAN_B_SKELETON listening on %s\n", socketPath)

	// TODO: consume from Redis Streams `events_wal`, perform CH Native insert.
	// For now: accept connections, log, close. Proves the socket path works.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			log.Printf("bematist-ingest-sidecar: connection accepted (would-insert)")
			_ = conn.Close()
		}
	}()

	<-sig
	log.Printf("bematist-ingest-sidecar: shutdown")
}
