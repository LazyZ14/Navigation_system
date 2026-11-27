FROM python:3.12-slim

WORKDIR /app
COPY backend /app
COPY data/tracks /data/tracks
ENV NAVIGATION_TRACK_DIR=/data/tracks
RUN pip install --no-cache-dir ".[dev]"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
