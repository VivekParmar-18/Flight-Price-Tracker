FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /config

ENV DB_PATH=/config/flights.db \
    TZ=America/Los_Angeles \
    PYTHONUNBUFFERED=1

VOLUME /config

EXPOSE 7002

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD python -c "import os, urllib.request; port = os.environ.get('PORT', 7002); urllib.request.urlopen(f'http://localhost:{port}/')" || exit 1

CMD ["python", "main.py"]
