# NeuroNexus on a Hugging Face Docker Space (single container, port 7860).
# The image is built from the public GitHub repository at a pinned commit; tools/deploy_space.py
# rewrites NN_REF on every deploy so each Space build is reproducible.
ARG NN_REPO=https://github.com/kmmohaimenulhaque-code/martian-map.git
ARG NN_REF=main

FROM node:22-slim AS source
ARG NN_REPO
ARG NN_REF
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# No git-lfs in the image: LFS files stay pointer stubs; MOLA comes from PDS below.
RUN git init -q . && git remote add origin "$NN_REPO" \
    && git fetch -q --depth 1 origin "$NN_REF" && git checkout -q FETCH_HEAD \
    && git rev-parse HEAD > /src/BUILD_COMMIT
WORKDIR /src/frontend
RUN npm ci --no-audit --no-fund && npm run build && rm -rf node_modules

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=7860 HOME=/home/user
RUN useradd -m -u 1000 user
WORKDIR /app
COPY --from=source --chown=user /src /app
RUN pip install --no-cache-dir -r deploy/requirements-api.txt
USER user
# Real NASA MOLA MEGDR tiles straight from the PDS Geosciences Node (size-checked, sha256 logged).
RUN python tools/fetch_mola.py --sites gale jezero \
    && (python tools/fetch_mola.py --all || echo "some MOLA tiles unavailable; terrain there answers 503")
RUN if [ -f tools/build_demo_pack.py ]; then python tools/build_demo_pack.py || echo "demo pack build failed; live sources only"; fi
EXPOSE 7860
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/openapi.json', timeout=5)"
CMD ["python", "-m", "uvicorn", "science.serve:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "2"]
