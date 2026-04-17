# syntax=docker/dockerfile:1.7
# Plan-B ingest sidecar — multi-stage distroless build.
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/sidecar ./cmd/sidecar

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /out/sidecar /sidecar
USER nonroot:nonroot
ENTRYPOINT ["/sidecar"]
