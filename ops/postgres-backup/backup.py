import json
import os
import subprocess
from datetime import datetime, timezone

import boto3

required = [
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
]
missing = [name for name in required if not os.environ.get(name)]
if missing:
    raise RuntimeError("Missing required variables: " + ",".join(missing))

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
key = os.environ.get("BACKUP_KEY") or f"postgres/transport-network-{stamp}.dump"
dump_path = "/tmp/transport-network.dump"

subprocess.run(
    [
        "pg_dump",
        os.environ["DATABASE_URL"],
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        dump_path,
    ],
    check=True,
)

size = os.path.getsize(dump_path)
if size <= 0:
    raise RuntimeError("pg_dump produced an empty file")

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    region_name=os.environ["S3_REGION"],
)
s3.upload_file(dump_path, os.environ["S3_BUCKET"], key)

manifest = {
    "event": "transport_postgres_backup_complete",
    "key": key,
    "sizeBytes": size,
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "databaseWrites": False,
}
manifest_key = key + ".json"
s3.put_object(
    Bucket=os.environ["S3_BUCKET"],
    Key=manifest_key,
    Body=json.dumps(manifest).encode("utf-8"),
    ContentType="application/json",
)

print("TN6PROD4_BACKUP " + json.dumps(manifest))
