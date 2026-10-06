FROM postgres:16

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-boto3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backup.py restore.py ./

CMD ["python3","backup.py"]
