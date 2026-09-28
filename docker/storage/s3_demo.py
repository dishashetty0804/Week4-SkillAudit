"""Create an S3 bucket, upload a file, list it, and read it back."""

import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from botocore.config import Config


endpoint = os.getenv("S3_ENDPOINT_URL", "http://localhost:9000")
bucket = os.getenv("S3_BUCKET", "parking-demo")
access_key = os.getenv("S3_ACCESS_KEY", "parking-dev-access")
secret_key = os.getenv("S3_SECRET_KEY", "parking-dev-secret-please-change")
s3 = boto3.client(
    "s3",
    endpoint_url=endpoint,
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    region_name="us-east-1",
    config=Config(s3={"addressing_style": "path"}),
)

try:
    s3.head_bucket(Bucket=bucket)
except ClientError as error:
    code = error.response.get("Error", {}).get("Code")
    if code not in {"404", "NoSuchBucket", "NotFound"}:
        raise
    s3.create_bucket(Bucket=bucket)

key = "hello-s3.txt"
body = b"Hello from the smart parking local object storage demo.\n"
s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="text/plain")
print(f"Objects in {bucket}:")
for item in s3.list_objects_v2(Bucket=bucket).get("Contents", []):
    print(f"- {item['Key']} ({item['Size']} bytes)")

download = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
if download != body:
    raise RuntimeError("Downloaded object did not match uploaded data")
Path(__file__).with_name("hello-s3-downloaded.txt").write_bytes(download)
print("Upload and read-back succeeded: docker/storage/hello-s3-downloaded.txt")
