# Bematist — Redpanda broker wrapped so we can set --advertise-kafka-addr.
# Railway's image-sourced deploy of Redpanda defaults to 127.0.0.1 as the
# advertised address, which makes every consumer outside the container fail.
# This wrapper uses CODE source + CMD override to get the advertised host
# pointing at the private domain.
FROM docker.redpanda.com/redpandadata/redpanda:v24.2.11
CMD ["redpanda", "start", \
  "--overprovisioned", \
  "--reserve-memory=0M", \
  "--lock-memory=false", \
  "--unsafe-bypass-fsync=true", \
  "--check=false", \
  "--kafka-addr=PLAINTEXT://0.0.0.0:9092", \
  "--advertise-kafka-addr=PLAINTEXT://kafka.railway.internal:9092"]
