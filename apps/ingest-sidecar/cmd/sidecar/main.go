// Plan-B ingest sidecar. Accepts newline-delimited JSON events on a UNIX
// socket and batches them into ClickHouse. Activated only if the 24h
// Bun→CH soak (F15 / INT0) shows flakes via @clickhouse/client HTTP.
// See apps/ingest-sidecar/README.md for activation instructions.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Event map[string]any

type Batcher struct {
	mu        sync.Mutex
	events    []Event
	maxBatch  int
	flushTick time.Duration
	flush     func(context.Context, []Event) error
}

func NewBatcher(max int, tick time.Duration, flush func(context.Context, []Event) error) *Batcher {
	return &Batcher{maxBatch: max, flushTick: tick, flush: flush}
}

func (b *Batcher) Add(e Event) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, e)
	return len(b.events) >= b.maxBatch
}

func (b *Batcher) Drain() []Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	batch := b.events
	b.events = nil
	return batch
}

func (b *Batcher) Run(ctx context.Context) {
	t := time.NewTicker(b.flushTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			if batch := b.Drain(); len(batch) > 0 {
				_ = b.flush(context.Background(), batch)
			}
			return
		case <-t.C:
			if batch := b.Drain(); len(batch) > 0 {
				if err := b.flush(ctx, batch); err != nil {
					log.Printf("sidecar: flush error: %v", err)
				}
			}
		}
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	sockPath := getenv("DEVMETRICS_SIDECAR_SOCKET", "/tmp/devmetrics-sidecar.sock")
	// Remove stale socket from prior run; ignore error.
	_ = os.Remove(sockPath)

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		log.Fatalf("sidecar: listen %s: %v", sockPath, err)
	}
	defer ln.Close()
	if err := os.Chmod(sockPath, 0o600); err != nil {
		log.Fatalf("sidecar: chmod: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Flush function: stub logs only. Real impl wires ClickHouse driver
	// (see internal/ch/writer.go). Kept separate for ease of testing.
	flush := func(ctx context.Context, batch []Event) error {
		log.Printf("sidecar: would flush %d events", len(batch))
		return nil
	}

	batcher := NewBatcher(1000, 500*time.Millisecond, flush)
	go batcher.Run(ctx)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					log.Printf("sidecar: accept: %v", err)
					continue
				}
			}
			go handleConn(conn, batcher)
		}
	}()

	log.Printf("sidecar: listening on %s", sockPath)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("sidecar: shutting down — draining final batch")
}

func handleConn(conn net.Conn, batcher *Batcher) {
	defer conn.Close()
	dec := json.NewDecoder(conn)
	for {
		var ev Event
		if err := dec.Decode(&ev); err != nil {
			return // EOF or malformed — terminate conn
		}
		batcher.Add(ev)
	}
}
