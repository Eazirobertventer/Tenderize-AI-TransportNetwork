FROM postgres:16

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-boto3 ca-certificates \
  && ln -s /usr/bin/python3 /usr/local/bin/python \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backup.py restore.py ./

CMD ["python","backup.py"]
