FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt ./backend/requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --disable-pip-version-check --timeout 30 --retries 2 --index-url "${PIP_INDEX_URL}" -r backend/requirements.txt
COPY backend ./backend
COPY frontend ./frontend
RUN mkdir -p /srv/data/music
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
