package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBatcher_FlushesOnSizeLimit(t *testing.T) {
	var got int64
	flush := func(ctx context.Context, batch []Event) error {
		atomic.AddInt64(&got, int64(len(batch)))
		return nil
	}
	b := NewBatcher(3, time.Hour /* long tick — rely on size trigger */, flush)

	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		b.Run(ctx)
	}()

	// Size-based trigger returns true on the 3rd add.
	if b.Add(Event{"n": 1}) {
		t.Fatalf("unexpected size trigger on 1st add")
	}
	if b.Add(Event{"n": 2}) {
		t.Fatalf("unexpected size trigger on 2nd add")
	}
	if !b.Add(Event{"n": 3}) {
		t.Fatalf("expected size trigger on 3rd add")
	}

	// Cancel to drain.
	cancel()
	wg.Wait()

	if got != 3 {
		t.Errorf("expected 3 flushed events, got %d", got)
	}
}

func TestBatcher_FlushesOnCancel(t *testing.T) {
	var got int64
	flush := func(ctx context.Context, batch []Event) error {
		atomic.AddInt64(&got, int64(len(batch)))
		return nil
	}
	b := NewBatcher(1000, time.Hour, flush)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		b.Run(ctx)
		close(done)
	}()

	b.Add(Event{"n": 1})
	b.Add(Event{"n": 2})

	cancel()
	<-done

	if got != 2 {
		t.Errorf("expected 2 flushed events on cancel, got %d", got)
	}
}

func TestBatcher_DrainReturnsEmptyAfterFlush(t *testing.T) {
	b := NewBatcher(10, time.Hour, func(ctx context.Context, batch []Event) error { return nil })
	b.Add(Event{"n": 1})
	first := b.Drain()
	if len(first) != 1 {
		t.Fatalf("expected 1 event in first drain, got %d", len(first))
	}
	second := b.Drain()
	if len(second) != 0 {
		t.Errorf("expected 0 events in second drain, got %d", len(second))
	}
}
