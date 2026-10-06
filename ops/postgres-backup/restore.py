import json
import os
import subprocess

import boto3

required = [
    "RESTORE_DATABASE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
    "BACKUP_KEY",
]
missing = [name for name in required if not os.environ.get(name)]
if missing:
    raise RuntimeError("Missing required variables: " + ",".join(missing))

dump_path = "/tmp/transport-network.dump"

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    region_name=os.environ["S3_REGION"],
)
s3.download_file(os.environ["S3_BUCKET"], os.environ["BACKUP_KEY"], dump_path)

subprocess.run(
    [
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        os.environ["RESTORE_DATABASE_URL"],
        dump_path,
    ],
    check=True,
)

def scalar(sql):
    out = subprocess.check_output(
        ["psql", os.environ["RESTORE_DATABASE_URL"], "-Atc", sql],
        text=True,
    ).strip()
    return int(out or "0")

proof = {
    "event": "transport_postgres_restore_complete",
    "sourceRegistry": scalar("select count(*) from source_registry"),
    "taxiRanks": scalar("select count(*) from taxi_rank"),
    "taxiAssociations": scalar("select count(*) from taxi_association"),
    "taxiRoutes": scalar("select count(*) from taxi_route"),
    "routeCandidates": scalar("select count(*) from route_candidate"),
}

if proof["sourceRegistry"] <= 0 or proof["taxiRanks"] <= 0:
    raise RuntimeError("restore verification failed: required tables are empty")

print("TN6PROD4_RESTORE " + json.dumps(proof))
