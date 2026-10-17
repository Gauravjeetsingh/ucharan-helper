# Build the CPU-only demo, including pinned model weights and prepared audio.
FROM python:3.12-slim-bookworm AS build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config git ffmpeg ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements-timestamps.txt ./
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY data/reference/ ./data/reference/
COPY data/lessons/*.json ./data/lessons/
RUN bash scripts/render_build.sh

# UI changes reuse the dependency/model/audio build layers above.
COPY apps/ ./apps/
COPY serve.py LICENSE THIRD_PARTY.md ./

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" PORT=10000 UCHAARAN_DEPLOYED_DEMO=1 \
    OMP_NUM_THREADS=2 HF_HOME=/tmp/uchaaran-huggingface
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 uchaaran \
    && useradd --uid 10001 --gid uchaaran --no-create-home --home-dir /tmp uchaaran
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app /app
# Application, supplied audio and weights stay root-owned and read-only to the worker.
USER 10001:10001
EXPOSE 10000
CMD ["python", "-m", "scripts.render_start"]
