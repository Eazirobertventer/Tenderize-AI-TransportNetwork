FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir boto3==1.35.95

WORKDIR /app
COPY backup.py restore.py ./

CMD ["python","backup.py"]
