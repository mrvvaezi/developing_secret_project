FROM node:22-slim AS frontend-build
WORKDIR /build
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt ./backend/requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --disable-pip-version-check --timeout 30 --retries 2 --index-url "${PIP_INDEX_URL}" -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend-build /build/out ./frontend/out
RUN mkdir -p /srv/data/music
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
